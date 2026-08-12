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

    await persistence.delete(session.id)
    await expect(persistence.read(session.id)).rejects.toThrow('Session file is missing')
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
      issues: [],
      summaries: [{ id: session.id, title: 'Recovered session', lastRunStatus: 'interrupted' }],
    })
    expect(restored.runs[0]).toMatchObject({
      status: 'interrupted',
      error: '应用在运行完成前关闭，任务未自动重放',
    })
    expect(stored).not.toContain(secret)
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

    expect(failedResult.issues).toEqual([
      expect.objectContaining({ code: 'credential-migration-failed', sessionId: null }),
    ])
    expect(failed.getRuntimePaths(projectId, unsafeSessionId).resumeSession).toBe(false)
    expect(failed.getRuntimePaths(projectId, safeSessionId).resumeSession).toBe(true)

    const migrateSuccessfully = vi.fn(async () => ({ attempted: true, failures: [] }))
    const recovered = new SessionPersistence(dataDirectory, secretStore, migrateSuccessfully)
    const recoveredResult = await recovered.recover([], failedResult.issues)

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
    const recoveredResult = await recovered.recover([], previousIssues)

    expect(recoveredResult.issues).toEqual([])
    expect(recovered.getRuntimePaths(projectId, sessionId).resumeSession).toBe(true)
  })
})
