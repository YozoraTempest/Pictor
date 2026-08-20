// @vitest-environment node

import { expect, it, vi } from 'vitest'

import type { Project, SessionHistoryState, SessionRecord } from '../../shared/domain.js'
import type { ModelSettings } from '../../shared/model.js'
import { RuntimeCoordinator, type RuntimeHost, type RuntimePersistence } from './coordinator.js'

const projectId = '01234567-89ab-4def-8123-456789abcdef'
const sessionId = '11234567-89ab-4def-8123-456789abcdef'

it.each(['a', 'id', 'running'])(
  'preserves runtime structure, terminal cleanup, and recovery for short key %s',
  async (secret) => {
    const now = new Date().toISOString()
    const session: SessionRecord = {
      schemaVersion: 1,
      id: sessionId,
      projectId,
      title: '新建会话',
      messages: [],
      runs: [],
      createdAt: now,
      updatedAt: now,
    }
    let saveCount = 0
    let history: SessionHistoryState = {
      authority: 'pi-jsonl',
      piSessionId: null,
      piSessionFile: null,
      legacyImport: { status: 'not-required', sourceFile: null },
    }
    let releasePersistence!: () => void
    const persistenceGate = new Promise<void>((resolve) => {
      releasePersistence = resolve
    })
    const saveSession = vi.fn(async () => {
      saveCount += 1
      if (saveCount > 1) await persistenceGate
      return { id: sessionId }
    })
    const repository: RuntimePersistence = {
      getSession: vi.fn(async () => session),
      getSessionHistory: vi.fn(() => history),
      bindPiSession: vi.fn(async (_sessionId, identity) => {
        history = {
          authority: 'pi-jsonl',
          piSessionId: identity.id,
          piSessionFile: identity.file,
          legacyImport: { status: 'not-required', sourceFile: null },
        }
      }),
      rebuildSessionProjection: vi.fn(async () => session),
      getProject: vi.fn(
        () =>
          ({
            id: projectId,
            name: 'fixture',
            rootPath: 'C:\\fixture',
            trustedAt: now,
            availability: 'available',
            createdAt: now,
            updatedAt: now,
          }) satisfies Project,
      ),
      getSettings: vi.fn(
        async () =>
          ({
            apiProtocol: 'chat-completions',
            baseUrl: 'https://example.test/v1',
            modelId: 'test-model',
            reasoningEffort: null,
            temperature: null,
            maxOutputTokens: null,
            hasApiKey: true,
          }) satisfies ModelSettings,
      ),
      getApiKey: vi.fn(async () => secret),
      getRuntimePaths: vi.fn(() => ({
        agentDirectory: 'C:\\fixture-agent',
        sessionDirectory: 'C:\\fixture-session',
        resumeSession: true,
      })),
      saveSession,
    }
    const start = vi.fn(async () => undefined)
    const supervisor: RuntimeHost = {
      isActive: vi.fn(() => false),
      start,
      approve: vi.fn(),
      reject: vi.fn(),
      stop: vi.fn(),
      respondToExtensionUi: vi.fn(),
      queueMessage: vi.fn(),
      clearQueue: vi.fn(),
    }
    const broadcast = vi.fn()
    const coordinator = new RuntimeCoordinator(repository, supervisor, broadcast)

    const started = await coordinator.start(sessionId, `prompt ${secret}`)
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: secret,
        prompt: expect.stringContaining('[REDACTED]'),
      }),
    )

    coordinator.handleEvent({
      type: 'session.bound',
      runId: started.runId,
      sessionId,
      at: new Date().toISOString(),
      piSessionId: 'pi-session-id',
      piSessionFile: 'session.jsonl',
    })

    coordinator.handleEvent({
      type: 'run.stateChanged',
      runId: started.runId,
      sessionId,
      at: new Date().toISOString(),
      status: 'running',
      error: `runtime error ${secret}`,
    })
    coordinator.handleEvent({
      type: 'tool.started',
      runId: started.runId,
      sessionId,
      at: new Date().toISOString(),
      callId: 'call-id',
      kind: 'read',
      label: `label ${secret}`,
      path: `path/${secret}`,
    })
    coordinator.handleEvent({
      type: 'tool.completed',
      runId: started.runId,
      sessionId,
      at: new Date().toISOString(),
      callId: 'call-id',
      output: `tool output ${secret}`,
      isError: false,
    })
    coordinator.handleEvent({
      type: 'message.completed',
      runId: started.runId,
      sessionId,
      messageId: session.messages[1]!.id,
      content: `assistant ${secret}`,
      at: new Date().toISOString(),
    })
    coordinator.handleEvent({
      type: 'run.stateChanged',
      runId: started.runId,
      sessionId,
      at: new Date().toISOString(),
      status: 'completed',
      error: null,
    })

    expect(coordinator.isActive()).toBe(true)
    expect(broadcast).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'run.stateChanged', status: 'completed' }),
    )
    releasePersistence()
    await vi.waitFor(() =>
      expect(repository.bindPiSession).toHaveBeenCalledWith(sessionId, {
        id: 'pi-session-id',
        file: 'session.jsonl',
      }),
    )
    await vi.waitFor(() =>
      expect(broadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'run.stateChanged',
          runId: started.runId,
          sessionId,
          status: 'completed',
        }),
      ),
    )
    expect(coordinator.isActive()).toBe(false)
    const run = session.runs[0]!
    expect(run.status).toBe('completed')
    expect(run.toolEvents[0]).toMatchObject({
      callId: 'call-id',
      status: 'completed',
      output: expect.stringContaining('[REDACTED]'),
    })
    expect(session.messages[1]).toMatchObject({
      id: expect.any(String),
      status: 'completed',
      content: expect.stringContaining('[REDACTED]'),
    })
    expect(saveSession).toHaveBeenCalledTimes(4)
    expect(repository.rebuildSessionProjection).toHaveBeenCalledWith(sessionId)
    expect(JSON.stringify(broadcast.mock.calls.map(([event]) => event))).toContain('[REDACTED]')

    await expect(coordinator.start(sessionId, 'subsequent prompt')).resolves.toEqual({
      runId: expect.any(String),
    })
    expect(start).toHaveBeenCalledTimes(2)
  },
)

it('persists a terminal failure when Pi Session identity was never bound', async () => {
  const now = new Date().toISOString()
  const session: SessionRecord = {
    schemaVersion: 1,
    id: sessionId,
    projectId,
    title: 'New session',
    messages: [],
    runs: [],
    createdAt: now,
    updatedAt: now,
  }
  const saveSession = vi.fn(async () => undefined)
  const rebuildSessionProjection = vi.fn(async () => session)
  const repository: RuntimePersistence = {
    getSession: vi.fn(async () => session),
    getSessionHistory: vi.fn(
      () =>
        ({
          authority: 'pi-jsonl',
          piSessionId: null,
          piSessionFile: null,
          legacyImport: { status: 'not-required', sourceFile: null },
        }) satisfies SessionHistoryState,
    ),
    bindPiSession: vi.fn(async () => undefined),
    rebuildSessionProjection,
    getProject: vi.fn(
      () =>
        ({
          id: projectId,
          name: 'fixture',
          rootPath: '/fixture',
          trustedAt: now,
          availability: 'available',
          createdAt: now,
          updatedAt: now,
        }) satisfies Project,
    ),
    getSettings: vi.fn(
      async () =>
        ({
          apiProtocol: 'chat-completions',
          baseUrl: 'https://example.test/v1',
          modelId: 'test-model',
          reasoningEffort: null,
          temperature: null,
          maxOutputTokens: null,
          hasApiKey: true,
        }) satisfies ModelSettings,
    ),
    getApiKey: vi.fn(async () => 'test-key'),
    getRuntimePaths: vi.fn(() => ({
      agentDirectory: '/agent',
      sessionDirectory: '/session',
      resumeSession: false,
    })),
    saveSession,
  }
  const supervisor: RuntimeHost = {
    isActive: vi.fn(() => false),
    start: vi.fn(async () => undefined),
    approve: vi.fn(),
    reject: vi.fn(),
    stop: vi.fn(),
    respondToExtensionUi: vi.fn(),
    queueMessage: vi.fn(),
    clearQueue: vi.fn(),
  }
  const broadcast = vi.fn()
  const coordinator = new RuntimeCoordinator(repository, supervisor, broadcast)

  const { runId } = await coordinator.start(sessionId, 'start')
  coordinator.handleEvent({
    type: 'run.stateChanged',
    runId,
    sessionId,
    at: new Date().toISOString(),
    status: 'failed',
    error: 'Pi Session failed before initialization',
  })

  await vi.waitFor(() =>
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'run.stateChanged', status: 'failed' }),
    ),
  )
  expect(saveSession).toHaveBeenCalledTimes(2)
  expect(rebuildSessionProjection).not.toHaveBeenCalled()
  expect(coordinator.isActive()).toBe(false)
})

it('keeps a pending Legacy Session Import read-only', async () => {
  const now = new Date().toISOString()
  const session: SessionRecord = {
    schemaVersion: 1,
    id: sessionId,
    projectId,
    title: 'Legacy history',
    messages: [],
    runs: [],
    createdAt: now,
    updatedAt: now,
  }
  const start = vi.fn(async () => undefined)
  const repository: RuntimePersistence = {
    getSession: vi.fn(async () => session),
    getSessionHistory: vi.fn(
      () =>
        ({
          authority: 'legacy-import',
          piSessionId: null,
          piSessionFile: null,
          legacyImport: { status: 'pending', sourceFile: 'legacy-imports/session.json' },
        }) satisfies SessionHistoryState,
    ),
    bindPiSession: vi.fn(async () => undefined),
    rebuildSessionProjection: vi.fn(async () => session),
    getProject: vi.fn(() => {
      throw new Error('must not resolve the project for read-only history')
    }),
    getSettings: vi.fn(async () => null),
    getApiKey: vi.fn(async () => null),
    getRuntimePaths: vi.fn(() => ({
      agentDirectory: '',
      sessionDirectory: '',
      resumeSession: false,
    })),
    saveSession: vi.fn(async () => undefined),
  }
  const supervisor: RuntimeHost = {
    isActive: () => false,
    start,
    approve: vi.fn(),
    reject: vi.fn(),
    stop: vi.fn(),
    respondToExtensionUi: vi.fn(),
    queueMessage: vi.fn(),
    clearQueue: vi.fn(),
  }
  const coordinator = new RuntimeCoordinator(repository, supervisor, vi.fn())

  await expect(coordinator.start(sessionId, 'continue')).rejects.toThrow('此会话是旧版只读历史')
  expect(start).not.toHaveBeenCalled()
})
