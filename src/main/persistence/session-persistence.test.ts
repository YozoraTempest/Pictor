// @vitest-environment node

import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DataIssue, SessionRecord, SessionSummary } from '../../shared/domain.js'
import { SecretStore } from './secret-store.js'
import { SessionPersistence } from './session-persistence.js'

function createSession(
  options: {
    id?: string
    projectId?: string
    title?: string
    content?: string
    runStatus?: SessionRecord['runs'][number]['status']
  } = {},
): SessionRecord {
  const now = new Date().toISOString()
  return {
    schemaVersion: 1,
    id: options.id ?? randomUUID(),
    projectId: options.projectId ?? randomUUID(),
    title: options.title ?? 'New session',
    messages: options.content
      ? [
          {
            id: randomUUID(),
            role: 'user',
            content: options.content,
            status: 'completed',
            createdAt: now,
            updatedAt: now,
          },
        ]
      : [],
    runs: options.runStatus
      ? [
          {
            id: randomUUID(),
            status: options.runStatus,
            toolEvents: [],
            error: null,
            createdAt: now,
            updatedAt: now,
          },
        ]
      : [],
    createdAt: now,
    updatedAt: now,
  }
}

function summarize(session: SessionRecord): SessionSummary {
  return {
    id: session.id,
    projectId: session.projectId,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastRunStatus: session.runs.at(-1)?.status ?? null,
  }
}

describe('SessionPersistence', () => {
  let testRoot: string
  let dataDirectory: string
  let secretStore: SecretStore

  beforeEach(async () => {
    testRoot = await mkdtemp(join(tmpdir(), 'pictor-session-persistence-'))
    dataDirectory = join(testRoot, 'data')
    secretStore = new SecretStore(dataDirectory)
  })

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true })
  })

  it('writes, reads, redacts, and deletes session files', async () => {
    const secret = ['persisted', 'credential', 'value'].join('-')
    await secretStore.setApiKey(secret)
    const persistence = new SessionPersistence(dataDirectory, secretStore)
    await persistence.recover([], [])
    const session = createSession({
      title: `title ${secret}`,
      content: `message ${secret}`,
    })

    const summary = await persistence.save(session)
    const restored = await persistence.read(session.id)
    const stored = await readFile(join(dataDirectory, 'sessions', `${session.id}.json`), 'utf8')

    expect(summary.title).toContain('[REDACTED]')
    expect(stored).not.toContain(secret)
    expect(restored.messages[0]?.content).toContain('[REDACTED]')
    expect(JSON.parse(stored)).toMatchObject({
      schemaVersion: 2,
      history: {
        authority: 'pi-jsonl',
        piSessionId: null,
        piSessionFile: null,
        legacyImport: { status: 'not-required', sourceFile: null },
      },
      projection: { messages: expect.any(Array), runs: expect.any(Array) },
    })
    await expect(persistence.inspectHistory(session.id, null)).resolves.toMatchObject({
      session: { id: session.id },
      tree: null,
    })

    await persistence.delete(session.id)
    await expect(persistence.read(session.id)).rejects.toThrow('Session file is missing')
  })

  it('rebuilds the Session Projection from bound Pi JSONL', async () => {
    const persistence = new SessionPersistence(dataDirectory, secretStore)
    await persistence.recover([], [])
    const session = createSession({ content: 'stale projection' })
    await persistence.save(session)
    expect(persistence.getRuntimePaths(session.projectId, session.id).resumeSession).toBe(false)
    const piFile = 'bound-session.jsonl'
    const piDirectory = join(dataDirectory, 'pi', session.projectId, session.id)
    await mkdir(piDirectory, { recursive: true })
    await writeFile(
      join(piDirectory, piFile),
      [
        JSON.stringify({
          type: 'session',
          version: 3,
          id: 'bound-pi-session',
          timestamp: session.createdAt,
          cwd: testRoot,
        }),
        JSON.stringify({
          type: 'message',
          id: 'pi-user',
          parentId: null,
          timestamp: session.createdAt,
          message: { role: 'user', content: 'Pi is authoritative' },
        }),
        JSON.stringify({
          type: 'message',
          id: 'pi-assistant',
          parentId: 'pi-user',
          timestamp: session.updatedAt,
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Projected from JSONL' }],
            stopReason: 'stop',
            usage: {
              input: 12,
              output: 8,
              cacheRead: 2,
              cacheWrite: 1,
              totalTokens: 23,
              cost: { input: 0.5, output: 0.75, cacheRead: 0, cacheWrite: 0, total: 1.25 },
            },
          },
        }),
        '',
      ].join('\n'),
    )
    await persistence.bindPiSession(session, { id: 'bound-pi-session', file: piFile })
    expect(persistence.getRuntimePaths(session.projectId, session.id).resumeSession).toBe(true)

    const rebuilt = await persistence.rebuildProjection(session.id)

    expect(rebuilt.messages.map(({ content }) => content)).toEqual([
      'Pi is authoritative',
      'Projected from JSONL',
    ])
    expect(rebuilt.usage).toEqual({
      tokens: { input: 12, output: 8, cacheRead: 2, cacheWrite: 1, total: 23 },
      cost: 1.25,
      context: null,
    })
    expect(rebuilt.runs).toEqual([expect.objectContaining({ status: 'completed', toolEvents: [] })])
    const stored = JSON.parse(
      await readFile(join(dataDirectory, 'sessions', `${session.id}.json`), 'utf8'),
    )
    expect(stored).toMatchObject({
      schemaVersion: 2,
      history: {
        authority: 'pi-jsonl',
        piSessionId: 'bound-pi-session',
        piSessionFile: piFile,
      },
      projection: {
        usage: {
          tokens: { input: 12, output: 8, cacheRead: 2, cacheWrite: 1, total: 23 },
          cost: 1.25,
          context: null,
        },
        messages: expect.arrayContaining([
          expect.objectContaining({ content: 'Projected from JSONL' }),
        ]),
      },
    })
  })

  it('inspects a historical Pi branch without replacing the stored active projection', async () => {
    const persistence = new SessionPersistence(dataDirectory, secretStore)
    await persistence.recover([], [])
    const session = createSession()
    await persistence.save(session)
    const piFile = 'branched-session.jsonl'
    const piDirectory = join(dataDirectory, 'pi', session.projectId, session.id)
    await mkdir(piDirectory, { recursive: true })
    await writeFile(
      join(piDirectory, piFile),
      [
        JSON.stringify({
          type: 'session',
          version: 3,
          id: 'branched-pi-session',
          timestamp: session.createdAt,
          cwd: testRoot,
        }),
        JSON.stringify({
          type: 'message',
          id: 'root-user',
          parentId: null,
          timestamp: session.createdAt,
          message: { role: 'user', content: 'Root task' },
        }),
        JSON.stringify({
          type: 'message',
          id: 'historical-answer',
          parentId: 'root-user',
          timestamp: '2026-08-20T00:00:01.000Z',
          message: { role: 'assistant', content: 'Historical answer', stopReason: 'stop' },
        }),
        JSON.stringify({
          type: 'message',
          id: 'active-answer',
          parentId: 'root-user',
          timestamp: '2026-08-20T00:00:02.000Z',
          message: { role: 'assistant', content: 'Active answer', stopReason: 'stop' },
        }),
        '',
      ].join('\n'),
    )
    await persistence.bindPiSession(session, { id: 'branched-pi-session', file: piFile })
    await persistence.rebuildProjection(session.id)

    const inspected = await persistence.inspectHistory(session.id, 'historical-answer')

    expect(inspected.session.messages.map((message) => message.content)).toEqual([
      'Root task',
      'Historical answer',
    ])
    expect(inspected.tree).toMatchObject({
      activeLeafId: 'active-answer',
      selectedEntryId: 'historical-answer',
    })
    expect((await persistence.read(session.id)).messages.map((message) => message.content)).toEqual(
      ['Root task', 'Active answer'],
    )

    await persistence.setActiveLeaf(session.id, 'historical-answer')
    expect(persistence.getRuntimePaths(session.projectId, session.id).activeLeafId).toBe(
      'historical-answer',
    )
    await persistence.rebuildProjection(session.id)
    expect((await persistence.read(session.id)).messages.map((message) => message.content)).toEqual(
      ['Root task', 'Historical answer'],
    )
    await expect(persistence.inspectHistory(session.id, null)).resolves.toMatchObject({
      tree: { activeLeafId: 'historical-answer', selectedEntryId: 'historical-answer' },
    })

    await persistence.setActiveLeaf(session.id, null)
    expect(persistence.getRuntimePaths(session.projectId, session.id)).toMatchObject({
      activeLeafId: null,
    })
    await persistence.rebuildProjection(session.id)
    expect((await persistence.read(session.id)).messages).toEqual([])
  })

  it('repairs historical content, summaries, and unfinished runs during recovery', async () => {
    const secret = ['historical', 'credential', 'value'].join('-')
    await secretStore.setApiKey(secret)
    const persistence = new SessionPersistence(dataDirectory, secretStore, async () => ({
      attempted: true,
      failures: [],
    }))
    const session = createSession({
      title: 'Recovered session',
      content: `historical ${secret}`,
      runStatus: 'running',
    })
    const staleSummary = { ...summarize(session), title: 'Stale title', lastRunStatus: null }
    await mkdir(join(dataDirectory, 'sessions'), { recursive: true })
    await writeFile(
      join(dataDirectory, 'sessions', `${session.id}.json`),
      `${JSON.stringify(session, null, 2)}\n`,
    )

    const result = await persistence.recover([staleSummary], [])
    const restored = await persistence.read(session.id)
    const stored = await readFile(join(dataDirectory, 'sessions', `${session.id}.json`), 'utf8')

    expect(result).toMatchObject({
      changed: true,
      issues: [
        expect.objectContaining({
          code: 'legacy-session-import-pending',
          sessionId: session.id,
        }),
      ],
      summaries: [{ id: session.id, title: 'Recovered session', lastRunStatus: 'interrupted' }],
    })
    expect(restored.runs[0]).toMatchObject({
      status: 'interrupted',
      error: '应用在运行完成前关闭，任务未自动重放',
    })
    expect(stored).not.toContain(secret)
    expect(JSON.parse(stored)).toMatchObject({
      schemaVersion: 2,
      history: {
        authority: 'legacy-import',
        legacyImport: {
          status: 'pending',
          sourceFile: `legacy-imports/${session.id}-schema-v1.json`,
        },
      },
    })
    expect(
      await readFile(
        join(dataDirectory, 'sessions', 'legacy-imports', `${session.id}-schema-v1.json`),
        'utf8',
      ),
    ).not.toContain(secret)
  })

  it('binds a legacy projection to an existing Pi JSONL identity', async () => {
    const persistence = new SessionPersistence(dataDirectory, secretStore)
    const session = createSession({ content: 'existing Pi history' })
    const summary = summarize(session)
    const piSessionId = '01a01c00-0000-7000-8000-000000000001'
    const piFile = '2026-08-20T00-00-00-000Z_session.jsonl'
    const piDirectory = join(dataDirectory, 'pi', session.projectId, session.id)
    await Promise.all([
      mkdir(join(dataDirectory, 'sessions'), { recursive: true }),
      mkdir(piDirectory, { recursive: true }),
    ])
    await writeFile(
      join(dataDirectory, 'sessions', `${session.id}.json`),
      `${JSON.stringify(session, null, 2)}\n`,
    )
    await writeFile(
      join(piDirectory, piFile),
      `${JSON.stringify({
        type: 'session',
        version: 3,
        id: piSessionId,
        timestamp: new Date().toISOString(),
        cwd: testRoot,
      })}\n`,
    )

    const result = await persistence.recover([summary], [])

    expect(result.issues).toEqual([])
    expect(persistence.getHistory(session.id)).toEqual({
      authority: 'pi-jsonl',
      piSessionId,
      piSessionFile: piFile,
      legacyImport: { status: 'not-required', sourceFile: null },
    })
    await expect(
      readFile(
        join(dataDirectory, 'sessions', 'legacy-imports', `${session.id}-schema-v1.json`),
        'utf8',
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('migrates an empty legacy Session without creating a pending import', async () => {
    const persistence = new SessionPersistence(dataDirectory, secretStore)
    const session = createSession()
    await mkdir(join(dataDirectory, 'sessions'), { recursive: true })
    await writeFile(
      join(dataDirectory, 'sessions', `${session.id}.json`),
      `${JSON.stringify(session, null, 2)}\n`,
    )

    const result = await persistence.recover([summarize(session)], [])

    expect(result.issues).toEqual([])
    expect(persistence.getHistory(session.id)).toMatchObject({
      authority: 'pi-jsonl',
      piSessionId: null,
      piSessionFile: null,
    })
  })

  it('removes stale Legacy Session Import issues during recovery', async () => {
    const persistence = new SessionPersistence(dataDirectory, secretStore)
    const issue: DataIssue = {
      code: 'legacy-session-import-pending',
      sessionId: randomUUID(),
      message: 'stale issue',
    }

    await expect(persistence.recover([], [issue])).resolves.toEqual({
      summaries: [],
      issues: [],
      changed: true,
    })
  })

  it('quarantines a corrupt session without affecting valid sessions', async () => {
    const persistence = new SessionPersistence(dataDirectory, secretStore)
    await persistence.recover([], [])
    const valid = createSession({ title: 'Valid session' })
    const corrupt = createSession({ title: 'Corrupt session' })
    const validSummary = await persistence.save(valid)
    await writeFile(join(dataDirectory, 'sessions', `${corrupt.id}.json`), '{invalid json')

    const result = await persistence.recover([summarize(corrupt), validSummary], [])
    const storedFiles = await readdir(join(dataDirectory, 'sessions'))

    expect(result.summaries).toEqual([validSummary])
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'session-corrupt', sessionId: corrupt.id }),
    ])
    expect(storedFiles.some((name) => name.startsWith(`${corrupt.id}.corrupt-`))).toBe(true)
    await expect(persistence.read(valid.id)).resolves.toMatchObject({ id: valid.id })
  })

  it('blocks only Pi sessions affected by a partial migration failure and recovers on retry', async () => {
    await secretStore.setApiKey('migration-credential-value')
    const projectId = randomUUID()
    const unsafeSessionId = randomUUID()
    const safeSessionId = randomUUID()
    const unsafeTranscript = join(dataDirectory, 'pi', projectId, unsafeSessionId, 'unsafe.jsonl')
    const failed = new SessionPersistence(dataDirectory, secretStore, async () => ({
      attempted: true,
      failures: [{ scope: 'pi', path: unsafeTranscript, operation: 'write' }],
    }))

    const failedResult = await failed.recover([], [])
    const unsafeSession = createSession({ id: unsafeSessionId, projectId })
    const safeSession = createSession({ id: safeSessionId, projectId })
    const unsafeSummary = await failed.save(unsafeSession)
    const safeSummary = await failed.save(safeSession)
    await failed.bindPiSession(unsafeSession, { id: 'unsafe-pi', file: 'unsafe.jsonl' })
    await failed.bindPiSession(safeSession, { id: 'safe-pi', file: 'safe.jsonl' })

    expect(failedResult.issues).toEqual([
      expect.objectContaining({ code: 'credential-migration-failed', sessionId: null }),
    ])
    expect(failed.getRuntimePaths(projectId, unsafeSessionId).resumeSession).toBe(false)
    expect(failed.getRuntimePaths(projectId, safeSessionId).resumeSession).toBe(true)

    const migrateSuccessfully = vi.fn(async () => ({ attempted: true, failures: [] }))
    const recovered = new SessionPersistence(dataDirectory, secretStore, migrateSuccessfully)
    const recoveredResult = await recovered.recover(
      [unsafeSummary, safeSummary],
      failedResult.issues,
    )

    expect(migrateSuccessfully).toHaveBeenCalledWith(dataDirectory, ['migration-credential-value'])
    expect(recoveredResult.issues).toEqual([])
    expect(recovered.getRuntimePaths(projectId, unsafeSessionId).resumeSession).toBe(true)
  })

  it('blocks every Pi resume when credentials cannot be read and clears the issue after migration', async () => {
    const getApiKey = vi.fn<() => Promise<string | null>>().mockRejectedValue(new Error('denied'))
    const migrateCredentials = vi.fn(async () => ({ attempted: true, failures: [] }))
    const failed = new SessionPersistence(dataDirectory, { getApiKey }, migrateCredentials)
    const projectId = randomUUID()
    const sessionId = randomUUID()

    const failedResult = await failed.recover([], [])
    const session = createSession({ id: sessionId, projectId })
    const summary = await failed.save(session)
    await failed.bindPiSession(session, { id: 'blocked-pi', file: 'blocked.jsonl' })

    expect(migrateCredentials).not.toHaveBeenCalled()
    expect(failedResult.issues).toEqual([
      expect.objectContaining({ code: 'credential-migration-failed', sessionId: null }),
    ])
    expect(failed.getRuntimePaths(projectId, sessionId).resumeSession).toBe(false)

    const previousIssues: DataIssue[] = failedResult.issues
    await secretStore.setApiKey('recovered-credential-value')
    const recovered = new SessionPersistence(dataDirectory, secretStore, async () => ({
      attempted: true,
      failures: [],
    }))
    const recoveredResult = await recovered.recover([summary], previousIssues)

    expect(recoveredResult.issues).toEqual([])
    expect(recovered.getRuntimePaths(projectId, sessionId).resumeSession).toBe(true)
  })
})
