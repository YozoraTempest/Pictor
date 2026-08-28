// @vitest-environment node

import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AppRepository } from './app-repository.js'
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

  function createRepository(): AppRepository {
    return new AppRepository(dataDirectory, new SecretStore(dataDirectory))
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

  it.runIf(process.platform !== 'win32')(
    'registers differently-cased directories as distinct projects on Linux',
    async () => {
      const upperDirectory = join(testRoot, 'Repo')
      const lowerDirectory = join(testRoot, 'repo')
      await mkdir(upperDirectory)
      await mkdir(lowerDirectory)
      const repository = createRepository()
      await repository.initialize()

      const upperProject = await repository.registerProject(upperDirectory)
      const lowerProject = await repository.registerProject(lowerDirectory)

      expect(lowerProject.id).not.toBe(upperProject.id)
      expect((await repository.getSnapshot()).projects).toHaveLength(2)
    },
  )

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
    const session = await repository.getSession(summary.id)
    session.projectId = randomUUID()

    await expect(repository.saveSession(session)).rejects.toThrow('项目绑定不匹配')
  })

  it.each([
    { kind: 'fork' as const, suffix: 'Fork' },
    { kind: 'clone' as const, suffix: 'Clone' },
  ])('commits a $kind Pi JSONL as a new selected Pictor Session', async ({ kind, suffix }) => {
    const repository = createRepository()
    await repository.initialize()
    const project = await repository.registerProject(projectDirectory)
    const source = await repository.createSession(project.id)
    await repository.renameSession(source.id, 'Source session')
    const targetSessionId = randomUUID()
    const piSessionId = `${kind}-pi-session`
    const piSessionFile = `${kind}.jsonl`
    const targetDirectory = join(dataDirectory, 'pi', project.id, targetSessionId)
    await mkdir(targetDirectory, { recursive: true })
    await writeFile(
      join(targetDirectory, piSessionFile),
      [
        JSON.stringify({
          type: 'session',
          version: 3,
          id: piSessionId,
          timestamp: new Date().toISOString(),
          cwd: projectDirectory,
        }),
        JSON.stringify({
          type: 'message',
          id: `${kind}-user`,
          parentId: null,
          timestamp: new Date().toISOString(),
          message: { role: 'user', content: 'Derived task' },
        }),
        JSON.stringify({
          type: 'message',
          id: `${kind}-assistant`,
          parentId: `${kind}-user`,
          timestamp: new Date().toISOString(),
          message: { role: 'assistant', content: 'Derived answer', stopReason: 'stop' },
        }),
        '',
      ].join('\n'),
    )

    const summary = await repository.createDerivedSession(source.id, targetSessionId, kind, {
      id: piSessionId,
      path: join(targetDirectory, piSessionFile),
    })
    const snapshot = await repository.getSnapshot()

    expect(summary).toMatchObject({
      id: targetSessionId,
      projectId: project.id,
      title: `Source session (${suffix})`,
      historyAuthority: 'pi-jsonl',
      lastRunStatus: 'completed',
    })
    expect(snapshot.selectedSessionId).toBe(targetSessionId)
    expect(snapshot.sessions).toHaveLength(2)
    await expect(repository.getSession(targetSessionId)).resolves.toMatchObject({
      messages: [
        expect.objectContaining({ content: 'Derived task' }),
        expect.objectContaining({ content: 'Derived answer' }),
      ],
    })
  })

  it('commits an imported Pi JSONL as a new selected Pictor Session', async () => {
    const repository = createRepository()
    await repository.initialize()
    const project = await repository.registerProject(projectDirectory)
    const targetSessionId = randomUUID()
    const targetDirectory = join(dataDirectory, 'pi', project.id, targetSessionId)
    await mkdir(targetDirectory, { recursive: true })
    await writeFile(
      join(targetDirectory, 'history.jsonl'),
      [
        JSON.stringify({
          type: 'session',
          version: 3,
          id: 'imported-pi-session',
          timestamp: new Date().toISOString(),
          cwd: projectDirectory,
        }),
        JSON.stringify({
          type: 'message',
          id: 'imported-user',
          parentId: null,
          timestamp: new Date().toISOString(),
          message: { role: 'user', content: 'Imported task' },
        }),
        '',
      ].join('\n'),
    )

    const summary = await repository.createImportedSession(
      project.id,
      targetSessionId,
      'history (Import)',
      { id: 'imported-pi-session', path: join(targetDirectory, 'history.jsonl') },
    )

    expect(summary).toMatchObject({
      id: targetSessionId,
      projectId: project.id,
      title: 'history (Import)',
      historyAuthority: 'pi-jsonl',
    })
    expect((await repository.getSnapshot()).selectedSessionId).toBe(targetSessionId)
    await expect(repository.getSession(targetSessionId)).resolves.toMatchObject({
      messages: [expect.objectContaining({ content: 'Imported task' })],
    })
  })

  it('removes Pictor metadata without deleting files from the project directory', async () => {
    const repository = createRepository()
    await repository.initialize()
    const projectFile = join(projectDirectory, 'keep.txt')
    await writeFile(projectFile, 'keep me')
    const project = await repository.registerProject(projectDirectory)
    const deletedSession = await repository.createSession(project.id)

    await repository.deleteSession(deletedSession.id)
    expect(await readFile(projectFile, 'utf8')).toBe('keep me')
    expect((await repository.getSnapshot()).sessions).toHaveLength(0)

    const projectSession = await repository.createSession(project.id)
    await repository.removeProject(project.id)
    expect(await readFile(projectFile, 'utf8')).toBe('keep me')
    expect((await repository.getSnapshot()).projects).toHaveLength(0)
    expect((await repository.getSnapshot()).sessions).toHaveLength(0)
    await expect(
      readFile(join(dataDirectory, 'sessions', `${projectSession.id}.json`), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('journals and cleans up an aborted Pi Session replacement', async () => {
    const repository = createRepository()
    await repository.initialize()
    const project = await repository.registerProject(projectDirectory)
    const source = await repository.createSession(project.id)
    const piDirectory = join(dataDirectory, 'pi', 'replacement')
    const sourcePiPath = join(piDirectory, 'source.jsonl')
    const orphanPiPath = join(piDirectory, 'orphan.jsonl')
    await mkdir(piDirectory, { recursive: true })
    await writeFile(sourcePiPath, '{"type":"session","id":"source"}\n')

    const operationId = randomUUID()
    const targetSessionId = randomUUID()
    await repository.prepareSessionReplacement({
      operationId,
      sourceSessionId: source.id,
      targetSessionId,
      kind: 'fork',
      targetProjectId: project.id,
      targetSessionPath: null,
      sourcePiSessionPath: sourcePiPath,
    })
    await writeFile(orphanPiPath, '{"type":"session","id":"orphan"}\n')

    await repository.abortSessionReplacement(operationId)

    await expect(readFile(orphanPiPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(sourcePiPath, 'utf8')).resolves.toContain('source')
    await expect(
      readFile(join(dataDirectory, 'session-replacement.json'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('recovers a committing replacement and keeps its target cwd project', async () => {
    const repository = createRepository()
    await repository.initialize()
    const sourceProject = await repository.registerProject(projectDirectory)
    const source = await repository.createSession(sourceProject.id)
    const targetDirectory = join(testRoot, 'target-project')
    await mkdir(targetDirectory)
    const targetProject = await repository.ensureProjectByPath(targetDirectory)
    const targetPiPath = join(targetDirectory, 'target.jsonl')
    await writeFile(
      targetPiPath,
      `${JSON.stringify({
        type: 'session',
        version: 3,
        id: 'target-pi-session',
        timestamp: new Date().toISOString(),
        cwd: targetDirectory,
      })}\n`,
    )

    const operationId = randomUUID()
    const targetSessionId = randomUUID()
    await repository.prepareSessionReplacement({
      operationId,
      sourceSessionId: source.id,
      targetSessionId,
      kind: 'switch',
      targetProjectId: targetProject.id,
      targetSessionPath: targetPiPath,
      sourcePiSessionPath: null,
    })
    const journalPath = join(dataDirectory, 'session-replacement.json')
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as Record<string, unknown>
    await writeFile(
      journalPath,
      JSON.stringify({
        ...journal,
        phase: 'committing',
        piSessionId: 'target-pi-session',
        piSessionPath: targetPiPath,
        cwd: targetDirectory,
      }),
    )

    const restored = createRepository()
    await restored.initialize()

    const snapshot = await restored.getSnapshot()
    expect(snapshot.selectedSessionId).toBe(targetSessionId)
    expect(snapshot.selectedProjectId).toBe(targetProject.id)
    expect(snapshot.sessions).toContainEqual(
      expect.objectContaining({ id: targetSessionId, projectId: targetProject.id }),
    )
    await expect(
      readFile(join(dataDirectory, 'session-replacement.json'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
