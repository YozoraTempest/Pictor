// @vitest-environment node

import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { SessionRecord } from '../../../src/shared/contracts.js'
import { AppRepository } from './app-repository.js'
import { SecretStore } from './secret-store.js'

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (plainText: string) => Buffer.from(plainText.split('').reverse().join('')),
  decryptString: (encrypted: Buffer) => encrypted.toString().split('').reverse().join(''),
}

describe('AppRepository', () => {
  let testRoot: string
  let dataDirectory: string
  let projectDirectory: string

  beforeEach(async () => {
    testRoot = await mkdtemp(join(tmpdir(), 'pictor-repository-'))
    dataDirectory = join(testRoot, 'data')
    projectDirectory = join(testRoot, 'project')
    await mkdir(projectDirectory)
  })

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true })
  })

  function createRepository(): AppRepository {
    return new AppRepository(dataDirectory, new SecretStore(dataDirectory, safeStorage))
  }

  it('restores projects, settings, sessions, and interrupts unfinished runs', async () => {
    const repository = createRepository()
    await repository.initialize()
    await repository.saveSettings({
      baseUrl: 'https://example.test/v1/',
      modelId: 'test-model',
      temperature: 0.2,
      maxOutputTokens: 2048,
      apiKey: { action: 'replace', value: 'top-secret-key' },
    })
    const project = await repository.registerProject(projectDirectory)
    expect((await repository.registerProject(projectDirectory)).id).toBe(project.id)

    const summary = await repository.createSession(project.id)
    const session = await repository.getSession(summary.id)
    const now = new Date().toISOString()
    session.messages.push({
      id: randomUUID(),
      role: 'user',
      content: 'Create a file',
      status: 'completed',
      createdAt: now,
      updatedAt: now,
    })
    session.runs.push({
      id: randomUUID(),
      status: 'running',
      toolEvents: [],
      error: null,
      createdAt: now,
      updatedAt: now,
    })
    await repository.saveSession(session)

    const restored = createRepository()
    await restored.initialize()
    const snapshot = await restored.getSnapshot()
    const restoredSession = await restored.getSession(summary.id)

    expect(snapshot.projects).toHaveLength(1)
    expect(snapshot.sessions).toHaveLength(1)
    expect(snapshot.settings).toEqual({
      baseUrl: 'https://example.test/v1',
      modelId: 'test-model',
      temperature: 0.2,
      maxOutputTokens: 2048,
      hasApiKey: true,
    })
    expect(restoredSession.messages[0]?.content).toBe('Create a file')
    expect(restoredSession.runs[0]).toMatchObject({
      status: 'interrupted',
      error: '应用在运行完成前关闭，任务未自动重放',
    })

    const stateContent = await readFile(join(dataDirectory, 'state.json'), 'utf8')
    const sessionContent = await readFile(
      join(dataDirectory, 'sessions', `${summary.id}.json`),
      'utf8',
    )
    const secretsContent = await readFile(join(dataDirectory, 'secrets.json'), 'utf8')
    expect(`${stateContent}${sessionContent}${secretsContent}`).not.toContain('top-secret-key')
    expect(await restored.getApiKey()).toBe('top-secret-key')
  })

  it('isolates a corrupt session without blocking valid sessions', async () => {
    const repository = createRepository()
    await repository.initialize()
    const project = await repository.registerProject(projectDirectory)
    const corrupt = await repository.createSession(project.id)
    const valid = await repository.createSession(project.id)
    await writeFile(join(dataDirectory, 'sessions', `${corrupt.id}.json`), '{invalid json')

    const restored = createRepository()
    await restored.initialize()
    const snapshot = await restored.getSnapshot()
    const storedFiles = await readdir(join(dataDirectory, 'sessions'))

    expect(snapshot.sessions.map((session) => session.id)).toEqual([valid.id])
    expect(snapshot.issues).toEqual([
      expect.objectContaining({ code: 'session-corrupt', sessionId: corrupt.id }),
    ])
    expect(storedFiles.some((name) => name.startsWith(`${corrupt.id}.corrupt-`))).toBe(true)
  })

  it('marks a project missing when its directory disappears', async () => {
    const repository = createRepository()
    await repository.initialize()
    const project = await repository.registerProject(projectDirectory)
    await rm(projectDirectory, { recursive: true })

    const snapshot = await repository.getSnapshot()
    expect(snapshot.projects.find((candidate) => candidate.id === project.id)?.availability).toBe(
      'missing',
    )
  })

  it('persists navigation selection and relinks a missing project without changing its identity', async () => {
    const repository = createRepository()
    await repository.initialize()
    const project = await repository.registerProject(projectDirectory)
    const session = await repository.createSession(project.id)
    await repository.selectContext(project.id, session.id)

    await rm(projectDirectory, { recursive: true })
    const replacementDirectory = join(testRoot, 'replacement-project')
    await mkdir(replacementDirectory)
    const relinked = await repository.relinkProject(project.id, replacementDirectory)

    const restored = createRepository()
    await restored.initialize()
    const snapshot = await restored.getSnapshot()
    expect(relinked).toMatchObject({ id: project.id, availability: 'available' })
    expect(snapshot.selectedProjectId).toBe(project.id)
    expect(snapshot.selectedSessionId).toBe(session.id)
    expect(snapshot.projects[0]).toMatchObject({
      id: project.id,
      name: 'replacement-project',
      rootPath: relinked.rootPath,
      availability: 'available',
    })
  })

  it('rejects a session whose project binding is changed', async () => {
    const repository = createRepository()
    await repository.initialize()
    const project = await repository.registerProject(projectDirectory)
    const summary = await repository.createSession(project.id)
    const session = (await repository.getSession(summary.id)) as SessionRecord
    session.projectId = randomUUID()

    await expect(repository.saveSession(session)).rejects.toThrow('项目绑定不匹配')
  })

  it('removes Pictor metadata without deleting files from the project directory', async () => {
    const repository = createRepository()
    await repository.initialize()
    const projectFile = join(projectDirectory, 'keep.txt')
    await writeFile(projectFile, 'keep me')
    const project = await repository.registerProject(projectDirectory)
    const session = await repository.createSession(project.id)

    await repository.deleteSession(session.id)
    expect(await readFile(projectFile, 'utf8')).toBe('keep me')
    expect((await repository.getSnapshot()).sessions).toHaveLength(0)

    await repository.removeProject(project.id)
    expect(await readFile(projectFile, 'utf8')).toBe('keep me')
    expect((await repository.getSnapshot()).projects).toHaveLength(0)
  })
})
