// @vitest-environment node

import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { SessionRecord } from '../../../src/shared/contracts.js'
import { AppRepository } from './app-repository.js'
import type { CredentialMigrationResult } from './credential-migration.js'
import { SecretStore } from './secret-store.js'

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

  function createRepository(
    migrateCredentials?: (
      dataDirectory: string,
      secretValues: readonly string[],
    ) => Promise<CredentialMigrationResult>,
  ): AppRepository {
    return new AppRepository(dataDirectory, new SecretStore(dataDirectory), migrateCredentials)
  }

  it('restores projects, settings, sessions, and interrupts unfinished runs', async () => {
    const storedApiKey = ['top', 'secret', 'key'].join('-')
    const repository = createRepository()
    await repository.initialize()
    await repository.saveSettings({
      apiProtocol: 'responses',
      baseUrl: 'https://example.test/v1/',
      modelId: 'test-model',
      reasoningEffort: 'high',
      temperature: 0.2,
      maxOutputTokens: 2048,
      apiKey: { action: 'replace', value: storedApiKey },
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
      apiProtocol: 'responses',
      baseUrl: 'https://example.test/v1',
      modelId: 'test-model',
      reasoningEffort: 'high',
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
    const authContent = await readFile(join(dataDirectory, 'auth.json'), 'utf8')
    expect(`${stateContent}${sessionContent}`).not.toContain(storedApiKey)
    expect(authContent).toContain(storedApiKey)
    expect(await restored.getApiKey()).toBe(storedApiKey)
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

  it('redacts the configured credential before session and renderer-visible state are persisted', async () => {
    const secret = ['write', 'boundary', 'credential'].join('-')
    const repository = createRepository()
    await repository.initialize()
    await repository.saveSettings({
      apiProtocol: 'chat-completions',
      baseUrl: 'https://example.test/v1',
      modelId: 'test-model',
      reasoningEffort: null,
      temperature: null,
      maxOutputTokens: null,
      apiKey: { action: 'replace', value: secret },
    })
    const project = await repository.registerProject(projectDirectory)
    const summary = await repository.createSession(project.id)
    const session = await repository.getSession(summary.id)
    const now = new Date().toISOString()
    session.title = `title ${secret}`
    session.messages.push({
      id: randomUUID(),
      role: 'assistant',
      content: `message ${secret}`,
      status: 'completed',
      createdAt: now,
      updatedAt: now,
    })
    session.runs.push({
      id: randomUUID(),
      status: 'failed',
      error: `error ${secret}`,
      toolEvents: [
        {
          id: randomUUID(),
          callId: 'credential-tool',
          kind: 'read',
          label: 'fixture',
          path: null,
          command: null,
          status: 'completed',
          output: `output ${secret}`,
          createdAt: now,
          updatedAt: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    })

    await repository.saveSession(session)

    const persisted = await Promise.all([
      readFile(join(dataDirectory, 'state.json'), 'utf8'),
      readFile(join(dataDirectory, 'sessions', `${summary.id}.json`), 'utf8'),
    ])
    const restored = await repository.getSession(summary.id)
    expect(persisted.join('\n')).not.toContain(secret)
    expect(JSON.stringify(restored)).not.toContain(secret)
    expect(restored.messages[0]?.content).toContain('[REDACTED]')
    expect(restored.runs[0]?.toolEvents[0]?.output).toContain('[REDACTED]')
  })

  it.each(['a', 'id', 'running'])(
    'accepts short credential %s while preserving persisted Session controls',
    async (secret) => {
      const repository = createRepository()
      await repository.initialize()
      await repository.saveSettings({
        apiProtocol: 'responses',
        baseUrl: 'https://example.test/v1',
        modelId: 'test-model',
        reasoningEffort: null,
        temperature: null,
        maxOutputTokens: null,
        apiKey: { action: 'replace', value: secret },
      })
      const project = await repository.registerProject(projectDirectory)
      const summary = await repository.createSession(project.id)
      const session = await repository.getSession(summary.id)
      const now = new Date().toISOString()
      const runId = randomUUID()
      const messageId = randomUUID()
      session.title = `title ${secret}`
      session.messages.push({
        id: messageId,
        role: 'user',
        content: `message ${secret}`,
        status: 'completed',
        createdAt: now,
        updatedAt: now,
      })
      session.runs.push({
        id: runId,
        status: 'running',
        error: `error ${secret}`,
        toolEvents: [],
        createdAt: now,
        updatedAt: now,
      })

      await repository.saveSession(session)

      const persisted = JSON.parse(
        await readFile(join(dataDirectory, 'sessions', `${summary.id}.json`), 'utf8'),
      ) as SessionRecord
      expect((await repository.getSettings())?.hasApiKey).toBe(true)
      expect(persisted).toMatchObject({
        id: summary.id,
        projectId: project.id,
        messages: [{ id: messageId, role: 'user', status: 'completed' }],
        runs: [{ id: runId, status: 'running' }],
      })
      expect(persisted.title).toContain('[REDACTED]')
      expect(persisted.messages[0]?.content).toContain('[REDACTED]')
      expect(persisted.runs[0]?.error).toContain('[REDACTED]')
    },
  )

  it('migrates legacy session and Pi data using the configured credential', async () => {
    const secret = ['legacy', 'stored', 'credential'].join('-')
    const repository = createRepository()
    await repository.initialize()
    await repository.saveSettings({
      apiProtocol: 'responses',
      baseUrl: 'https://example.test/v1',
      modelId: 'test-model',
      reasoningEffort: null,
      temperature: null,
      maxOutputTokens: null,
      apiKey: { action: 'replace', value: secret },
    })
    const project = await repository.registerProject(projectDirectory)
    const summary = await repository.createSession(project.id)
    const session = await repository.getSession(summary.id)
    const now = new Date().toISOString()
    session.messages.push({
      id: randomUUID(),
      role: 'user',
      content: `legacy ${secret} keep`,
      status: 'completed',
      createdAt: now,
      updatedAt: now,
    })
    const sessionPath = join(dataDirectory, 'sessions', `${summary.id}.json`)
    const transcriptDirectory = join(dataDirectory, 'pi', project.id, summary.id)
    const transcriptPath = join(transcriptDirectory, 'legacy.jsonl')
    await writeFile(sessionPath, `${JSON.stringify(session, null, 2)}\n`)
    await mkdir(transcriptDirectory, { recursive: true })
    await writeFile(
      transcriptPath,
      [
        JSON.stringify({
          type: 'session',
          version: 3,
          id: summary.id,
          timestamp: now,
          cwd: projectDirectory,
        }),
        JSON.stringify({
          type: 'message',
          id: randomUUID(),
          parentId: null,
          timestamp: now,
          message: { role: 'user', content: `legacy ${secret} transcript` },
        }),
        '',
      ].join('\n'),
    )

    const restored = createRepository()
    await restored.initialize()
    const firstPass = await Promise.all([
      readFile(sessionPath, 'utf8'),
      readFile(transcriptPath, 'utf8'),
    ])
    await restored.initialize()
    const secondPass = await Promise.all([
      readFile(sessionPath, 'utf8'),
      readFile(transcriptPath, 'utf8'),
    ])

    expect(secondPass).toEqual(firstPass)
    expect(firstPass.join('\n')).not.toContain(secret)
    expect(firstPass[0]).toContain('legacy [REDACTED] keep')
    expect(firstPass[1]).toContain('"type":"session"')
    expect(firstPass[1]).toContain('legacy [REDACTED] transcript')
  })

  it('persists migration failures, blocks unsafe transcript resume, and recovers on retry', async () => {
    const secret = ['migration', 'failure', 'credential'].join('-')
    const repository = createRepository()
    await repository.initialize()
    await repository.saveSettings({
      apiProtocol: 'responses',
      baseUrl: 'https://example.test/v1',
      modelId: 'test-model',
      reasoningEffort: null,
      temperature: null,
      maxOutputTokens: null,
      apiKey: { action: 'replace', value: secret },
    })
    const project = await repository.registerProject(projectDirectory)
    const session = await repository.createSession(project.id)
    const unsafeTranscript = join(dataDirectory, 'pi', project.id, session.id, 'unsafe.jsonl')

    const failed = createRepository(async () => ({
      attempted: true,
      failures: [{ scope: 'pi', path: unsafeTranscript, operation: 'write' }],
    }))
    await failed.initialize()

    const failedSnapshot = await failed.getSnapshot()
    const persistedFailure = await readFile(join(dataDirectory, 'state.json'), 'utf8')
    expect(failedSnapshot.issues).toEqual([
      expect.objectContaining({
        code: 'credential-migration-failed',
        sessionId: null,
      }),
    ])
    expect(JSON.stringify(failedSnapshot.issues)).not.toContain(secret)
    expect(persistedFailure).not.toContain(secret)
    expect(failed.getRuntimePaths(project.id, session.id).resumeSession).toBe(false)

    const recovered = createRepository(async () => ({ attempted: true, failures: [] }))
    await recovered.initialize()

    expect((await recovered.getSnapshot()).issues).toEqual([])
    expect(recovered.getRuntimePaths(project.id, session.id).resumeSession).toBe(true)
    expect(await readFile(join(dataDirectory, 'state.json'), 'utf8')).not.toContain(
      'credential-migration-failed',
    )
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
