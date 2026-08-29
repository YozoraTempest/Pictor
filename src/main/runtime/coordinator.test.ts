// @vitest-environment node

import { expect, it, vi } from 'vitest'

import type {
  Project,
  SessionHistoryState,
  SessionHistoryView,
  SessionRecord,
  SessionSummary,
} from '../../shared/domain.js'
import type { ModelSettings } from '../../shared/model.js'
import { RuntimeCoordinator, type RuntimeHost, type RuntimePersistence } from './coordinator.js'

const projectId = '01234567-89ab-4def-8123-456789abcdef'
const sessionId = '11234567-89ab-4def-8123-456789abcdef'

function historyView(session: SessionRecord, activeLeafId: string | null): SessionHistoryView {
  return {
    session,
    tree: activeLeafId
      ? { activeLeafId, selectedEntryId: activeLeafId, nodes: [] }
      : { activeLeafId: null, selectedEntryId: null, nodes: [] },
  }
}

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
    const savedStatuses: Array<SessionRecord['runs'][number]['status'] | null> = []
    let history: SessionHistoryState = {
      authority: 'pi-jsonl',
      piSessionId: null,
      piSessionPath: null,
      legacyImport: { status: 'not-required', sourceFile: null },
    }
    let releasePersistence!: () => void
    const persistenceGate = new Promise<void>((resolve) => {
      releasePersistence = resolve
    })
    const saveSession = vi.fn(async (savedSession: SessionRecord) => {
      saveCount += 1
      savedStatuses.push(savedSession.runs.at(-1)?.status ?? null)
      if (saveCount > 1) await persistenceGate
      return { id: sessionId }
    })
    const repository: RuntimePersistence = {
      getSelectedContext: vi.fn(() => ({ projectId, sessionId })),
      removeProject: vi.fn(async () => undefined),
      deleteSession: vi.fn(async () => undefined),
      getSession: vi.fn(async () => session),
      getSessionHistory: vi.fn(() => history),
      inspectSessionHistory: vi.fn(async () => historyView(session, null)),
      bindPiSession: vi.fn(async (_sessionId, identity) => {
        history = {
          authority: 'pi-jsonl',
          piSessionId: identity.id,
          piSessionPath: identity.path ?? null,
          legacyImport: { status: 'not-required', sourceFile: null },
        }
      }),
      rebuildSessionProjection: vi.fn(async () => session),
      setPiSessionActiveLeaf: vi.fn(async () => undefined),
      createDerivedSession: vi.fn(async () => {
        throw new Error('not used')
      }),
      createImportedSession: vi.fn(async () => {
        throw new Error('not used')
      }),
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
        piSessionPath: 'C:\\fixture-session\\session.jsonl',
        activeLeafId: 'persisted-active-leaf',
        runtimePreferences: {
          modelId: 'session-model',
          thinkingLevel: 'high',
          activeTools: ['read'],
          steeringMode: 'all',
          followUpMode: 'one-at-a-time',
        } satisfies NonNullable<SessionHistoryState['runtimePreferences']>,
      })),
      saveSession,
    }
    const start = vi.fn(async () => undefined)
    const supervisor: RuntimeHost = {
      isActive: vi.fn(() => false),
      start,
      fork: vi.fn(async () => {
        throw new Error('not used')
      }),
      importSession: vi.fn(async () => {
        throw new Error('not used')
      }),
      exportSession: vi.fn(async () => {
        throw new Error('not used')
      }),
      navigateSession: vi.fn(async () => {
        throw new Error('not used')
      }),
      compactSession: vi.fn(async () => {
        throw new Error('not used')
      }),
      labelSessionEntry: vi.fn(async () => {
        throw new Error('not used')
      }),
      abortSessionOperation: vi.fn(),
      reloadResources: vi.fn(async () => undefined),
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
        sessionName: expect.stringContaining('prompt'),
        piSessionPath: 'C:\\fixture-session\\session.jsonl',
        activeLeafId: 'persisted-active-leaf',
        runtimePreferences: expect.objectContaining({ thinkingLevel: 'high' }),
      }),
    )

    coordinator.handleEvent({
      type: 'session.bound',
      runId: null,
      sessionId,
      at: new Date().toISOString(),
      piSessionId: 'pi-session-id',
      piSessionPath: 'C:\\fixture-session\\session.jsonl',
    })

    coordinator.handleEvent({
      type: 'run.stateChanged',
      runId: started.runId,
      sessionId,
      at: new Date().toISOString(),
      status: 'running',
      error: `runtime error ${secret}`,
    })
    const extensionUiRequestId = '71234567-89ab-4def-8123-456789abcdef'
    coordinator.handleEvent({
      type: 'extension.ui.requested',
      runId: started.runId,
      sessionId,
      at: new Date().toISOString(),
      requestId: extensionUiRequestId,
      kind: 'input',
      title: 'Enter a value',
      message: null,
      options: [],
      value: null,
    })
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'extension.ui.requested',
        requestId: extensionUiRequestId,
      }),
    )
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
      type: 'session.activeLeafChanged',
      runId: started.runId,
      sessionId,
      at: new Date().toISOString(),
      activeLeafId: 'new-active-leaf',
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
        path: 'C:\\fixture-session\\session.jsonl',
      }),
    )
    await vi.waitFor(() =>
      expect(repository.setPiSessionActiveLeaf).toHaveBeenCalledWith(sessionId, 'new-active-leaf'),
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
    expect(savedStatuses).toEqual(['queued', 'running', 'running', 'running'])
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
    getSelectedContext: vi.fn(() => ({ projectId, sessionId })),
    removeProject: vi.fn(async () => undefined),
    deleteSession: vi.fn(async () => undefined),
    getSession: vi.fn(async () => session),
    getSessionHistory: vi.fn(
      () =>
        ({
          authority: 'pi-jsonl',
          piSessionId: null,
          piSessionPath: null,
          legacyImport: { status: 'not-required', sourceFile: null },
        }) satisfies SessionHistoryState,
    ),
    inspectSessionHistory: vi.fn(async () => historyView(session, null)),
    bindPiSession: vi.fn(async () => undefined),
    rebuildSessionProjection,
    setPiSessionActiveLeaf: vi.fn(async () => undefined),
    createDerivedSession: vi.fn(async () => {
      throw new Error('not used')
    }),
    createImportedSession: vi.fn(async () => {
      throw new Error('not used')
    }),
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
    fork: vi.fn(async () => {
      throw new Error('not used')
    }),
    importSession: vi.fn(async () => {
      throw new Error('not used')
    }),
    exportSession: vi.fn(async () => {
      throw new Error('not used')
    }),
    navigateSession: vi.fn(async () => {
      throw new Error('not used')
    }),
    compactSession: vi.fn(async () => {
      throw new Error('not used')
    }),
    labelSessionEntry: vi.fn(async () => {
      throw new Error('not used')
    }),
    abortSessionOperation: vi.fn(),
    reloadResources: vi.fn(async () => undefined),
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
    getSelectedContext: vi.fn(() => ({ projectId, sessionId })),
    removeProject: vi.fn(async () => undefined),
    deleteSession: vi.fn(async () => undefined),
    getSession: vi.fn(async () => session),
    getSessionHistory: vi.fn(
      () =>
        ({
          authority: 'legacy-import',
          piSessionId: null,
          piSessionPath: null,
          legacyImport: { status: 'pending', sourceFile: 'legacy-imports/session.json' },
        }) satisfies SessionHistoryState,
    ),
    inspectSessionHistory: vi.fn(async () => historyView(session, null)),
    bindPiSession: vi.fn(async () => undefined),
    rebuildSessionProjection: vi.fn(async () => session),
    setPiSessionActiveLeaf: vi.fn(async () => undefined),
    createDerivedSession: vi.fn(async () => {
      throw new Error('not used')
    }),
    createImportedSession: vi.fn(async () => {
      throw new Error('not used')
    }),
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
    fork: vi.fn(async () => {
      throw new Error('not used')
    }),
    importSession: vi.fn(async () => {
      throw new Error('not used')
    }),
    exportSession: vi.fn(async () => {
      throw new Error('not used')
    }),
    navigateSession: vi.fn(async () => {
      throw new Error('not used')
    }),
    compactSession: vi.fn(async () => {
      throw new Error('not used')
    }),
    labelSessionEntry: vi.fn(async () => {
      throw new Error('not used')
    }),
    abortSessionOperation: vi.fn(),
    reloadResources: vi.fn(async () => undefined),
    stop: vi.fn(),
    respondToExtensionUi: vi.fn(),
    queueMessage: vi.fn(),
    clearQueue: vi.fn(),
  }
  const coordinator = new RuntimeCoordinator(repository, supervisor, vi.fn())

  await expect(coordinator.start(sessionId, 'continue')).rejects.toThrow('此会话是旧版只读历史')
  expect(start).not.toHaveBeenCalled()
})

it('commits native Pi Session derivation and Import operations', async () => {
  const now = new Date().toISOString()
  const session: SessionRecord = {
    schemaVersion: 1,
    id: sessionId,
    projectId,
    title: 'Source session',
    messages: [],
    runs: [],
    createdAt: now,
    updatedAt: now,
  }
  const forkedSummary: SessionSummary = {
    id: '61234567-89ab-4def-8123-456789abcdef',
    projectId,
    title: 'Source session (Fork)',
    lastRunStatus: 'completed',
    historyAuthority: 'pi-jsonl',
    createdAt: now,
    updatedAt: now,
  }
  const clonedSummary: SessionSummary = {
    ...forkedSummary,
    id: '71234567-89ab-4def-8123-456789abcdef',
    title: 'Source session (Clone)',
  }
  const importedSummary: SessionSummary = {
    ...forkedSummary,
    id: '81234567-89ab-4def-8123-456789abcdef',
    title: 'source-history (Import)',
  }
  let releaseCommit!: () => void
  const commitGate = new Promise<void>((resolve) => {
    releaseCommit = resolve
  })
  const createDerivedSession = vi.fn(
    async (_sourceSessionId: string, _targetSessionId: string, kind: 'fork' | 'clone') => {
      if (kind === 'fork') await commitGate
      return kind === 'clone' ? clonedSummary : forkedSummary
    },
  )
  const createImportedSession = vi.fn(async () => importedSummary)
  let activeLeafId: string | null = 'active-entry'
  const inspectSessionHistory = vi.fn(
    async (_sourceSessionId: string, selectedEntryId: string | null) => ({
      ...historyView(session, activeLeafId),
      tree: {
        activeLeafId,
        selectedEntryId: selectedEntryId ?? activeLeafId,
        nodes: [
          {
            id: 'historical-entry',
            parentId: null,
            kind: 'assistant' as const,
            label: 'Historical answer',
            timestamp: now,
            depth: 0,
            childCount: 0,
            isActivePath: activeLeafId === 'historical-entry',
            isActiveLeaf: activeLeafId === 'historical-entry',
            isSelected: (selectedEntryId ?? activeLeafId) === 'historical-entry',
          },
          {
            id: 'active-entry',
            parentId: null,
            kind: 'assistant' as const,
            label: 'Active answer',
            timestamp: now,
            depth: 0,
            childCount: 0,
            isActivePath: activeLeafId === 'active-entry',
            isActiveLeaf: activeLeafId === 'active-entry',
            isSelected: (selectedEntryId ?? activeLeafId) === 'active-entry',
          },
          {
            id: 'root-user-entry',
            parentId: null,
            kind: 'user' as const,
            label: 'Root user task',
            timestamp: now,
            depth: 0,
            childCount: 0,
            isActivePath: false,
            isActiveLeaf: false,
            isSelected: selectedEntryId === 'root-user-entry',
          },
        ],
      },
    }),
  )
  const setPiSessionActiveLeaf = vi.fn(async (_sessionId: string, entryId: string | null) => {
    activeLeafId = entryId
  })
  const repository: RuntimePersistence = {
    getSelectedContext: vi.fn(() => ({ projectId, sessionId })),
    removeProject: vi.fn(async () => undefined),
    deleteSession: vi.fn(async () => undefined),
    getSession: vi.fn(async () => session),
    getSessionHistory: vi.fn(
      () =>
        ({
          authority: 'pi-jsonl',
          piSessionId: 'source-pi-session',
          piSessionPath: '/sessions/session-id/source.jsonl',
          activeLeafId,
          legacyImport: { status: 'not-required', sourceFile: null },
        }) satisfies SessionHistoryState,
    ),
    inspectSessionHistory,
    bindPiSession: vi.fn(async () => undefined),
    rebuildSessionProjection: vi.fn(async () => session),
    setPiSessionActiveLeaf,
    createDerivedSession,
    createImportedSession,
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
          apiProtocol: 'responses',
          baseUrl: 'https://example.test/v1',
          modelId: 'test-model',
          reasoningEffort: null,
          temperature: null,
          maxOutputTokens: null,
          hasApiKey: true,
        }) satisfies ModelSettings,
    ),
    getApiKey: vi.fn(async () => 'test-key'),
    getRuntimePaths: vi.fn((_projectId, targetSessionId) => ({
      agentDirectory: '/agent',
      sessionDirectory: `/sessions/${targetSessionId}`,
      resumeSession: targetSessionId === sessionId,
      activeLeafId: targetSessionId === sessionId ? activeLeafId : null,
    })),
    saveSession: vi.fn(async () => undefined),
  }
  const fork = vi.fn<RuntimeHost['fork']>(async (config) => ({
    type: 'host.forkResult',
    operationId: config.operationId,
    targetSessionId: config.targetSessionId,
    outcome: 'completed',
    piSessionId: 'forked-pi-session',
    piSessionPath: '/sessions/forked-session.jsonl',
  }))
  const importSession = vi.fn<RuntimeHost['importSession']>(async (config) => ({
    type: 'host.importResult',
    operationId: config.operationId,
    targetSessionId: config.targetSessionId,
    outcome: 'completed',
    piSessionId: 'imported-pi-session',
    piSessionPath: '/sessions/imported-session/source-history.jsonl',
  }))
  const exportSession = vi.fn<RuntimeHost['exportSession']>(async (config) => ({
    type: 'host.exportResult',
    operationId: config.operationId,
    sourceSessionId: config.sourceSessionId,
    outcome: 'completed',
  }))
  const navigateSession = vi.fn<RuntimeHost['navigateSession']>(async (config) => ({
    type: 'host.navigateResult',
    operationId: config.operationId,
    sourceSessionId: config.sourceSessionId,
    outcome: 'completed',
    activeLeafId: config.entryId,
    editorText: null,
    summaryCreated: false,
  }))
  const compactSession = vi.fn<RuntimeHost['compactSession']>(async (config) => ({
    type: 'host.compactResult',
    operationId: config.operationId,
    sourceSessionId: config.sourceSessionId,
    outcome: 'completed',
    activeLeafId: 'compaction-entry',
    tokensBefore: 100,
    estimatedTokensAfter: 25,
  }))
  const labelSessionEntry = vi.fn<RuntimeHost['labelSessionEntry']>(async (config) => ({
    type: 'host.labelResult',
    operationId: config.operationId,
    sourceSessionId: config.sourceSessionId,
    outcome: 'completed',
    activeLeafId: 'label-entry',
  }))
  const abortSessionOperation = vi.fn()
  const reloadResources = vi.fn(async () => undefined)
  const supervisor: RuntimeHost = {
    isActive: () => false,
    start: vi.fn(async () => undefined),
    fork,
    importSession,
    exportSession,
    navigateSession,
    compactSession,
    labelSessionEntry,
    abortSessionOperation,
    reloadResources,
    stop: vi.fn(),
    respondToExtensionUi: vi.fn(),
    queueMessage: vi.fn(),
    clearQueue: vi.fn(),
  }
  const coordinator = new RuntimeCoordinator(repository, supervisor, vi.fn())

  const forking = coordinator.forkSession(sessionId, 'selected-entry')
  await vi.waitFor(() => expect(createDerivedSession).toHaveBeenCalledOnce())
  expect(coordinator.isActive()).toBe(true)
  releaseCommit()
  await expect(forking).resolves.toEqual(forkedSummary)
  expect(coordinator.isActive()).toBe(false)
  expect(fork).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'fork',
      sourceSessionId: sessionId,
      entryId: 'selected-entry',
      sourcePiSessionPath: '/sessions/session-id/source.jsonl',
    }),
  )
  const forkConfig = fork.mock.calls[0]![0]
  expect(createDerivedSession).toHaveBeenCalledWith(sessionId, forkConfig.targetSessionId, 'fork', {
    id: 'forked-pi-session',
    path: '/sessions/forked-session.jsonl',
  })

  fork.mockResolvedValueOnce({
    type: 'host.forkResult',
    operationId: '31234567-89ab-4def-8123-456789abcdef',
    targetSessionId: '41234567-89ab-4def-8123-456789abcdef',
    outcome: 'cancelled',
  })
  await expect(coordinator.forkSession(sessionId, 'cancelled-entry')).resolves.toBeNull()
  expect(createDerivedSession).toHaveBeenCalledTimes(1)

  await expect(coordinator.cloneSession(sessionId)).resolves.toEqual(clonedSummary)
  const cloneConfig = fork.mock.calls[2]![0]
  expect(cloneConfig.entryId).toBe('active-entry')
  expect(inspectSessionHistory).toHaveBeenLastCalledWith(sessionId, null)
  expect(createDerivedSession).toHaveBeenLastCalledWith(
    sessionId,
    cloneConfig.targetSessionId,
    'clone',
    {
      id: 'forked-pi-session',
      path: '/sessions/forked-session.jsonl',
    },
  )

  await expect(coordinator.forkSession(sessionId, 'active-entry')).rejects.toThrow(
    '请使用 Clone 复制当前分支',
  )
  expect(fork).toHaveBeenCalledTimes(3)

  await expect(
    coordinator.importSession(projectId, '/imports/source-history.jsonl'),
  ).resolves.toEqual(importedSummary)
  const importConfig = importSession.mock.calls[0]![0]
  expect(importConfig).toMatchObject({
    type: 'import',
    projectRoot: '/fixture',
    sourceJsonlPath: '/imports/source-history.jsonl',
    targetSessionDirectory: expect.stringMatching(/^\/sessions\//),
  })
  expect(createImportedSession).toHaveBeenCalledWith(
    projectId,
    importConfig.targetSessionId,
    'source-history (Import)',
    { id: 'imported-pi-session', path: '/sessions/imported-session/source-history.jsonl' },
  )

  importSession.mockResolvedValueOnce({
    type: 'host.importResult',
    operationId: '91234567-89ab-4def-8123-456789abcdef',
    targetSessionId: 'a1234567-89ab-4def-8123-456789abcdef',
    outcome: 'cancelled',
  })
  await expect(coordinator.importSession(projectId, '/imports/cancelled.jsonl')).resolves.toBeNull()
  expect(createImportedSession).toHaveBeenCalledOnce()

  await expect(
    coordinator.exportSession(sessionId, 'jsonl', '/exports/source.jsonl'),
  ).resolves.toBeUndefined()
  expect(exportSession).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'export',
      sourceSessionId: sessionId,
      format: 'jsonl',
      sourcePiSessionPath: '/sessions/session-id/source.jsonl',
      activeLeafId: 'active-entry',
      destinationPath: '/exports/source.jsonl',
    }),
  )

  await expect(
    coordinator.navigateSessionTree(sessionId, 'historical-entry'),
  ).resolves.toMatchObject({
    history: {
      tree: { activeLeafId: 'historical-entry', selectedEntryId: 'historical-entry' },
    },
  })
  expect(navigateSession).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'navigate',
      sourceSessionId: sessionId,
      entryId: 'historical-entry',
      summarize: false,
      customInstructions: null,
      activeLeafId: 'active-entry',
      sourcePiSessionPath: '/sessions/session-id/source.jsonl',
    }),
  )
  expect(setPiSessionActiveLeaf).toHaveBeenCalledWith(sessionId, 'historical-entry')
  expect(repository.rebuildSessionProjection).toHaveBeenCalledWith(sessionId)

  navigateSession.mockResolvedValueOnce({
    type: 'host.navigateResult',
    operationId: '31234567-89ab-4def-8123-456789abcdef',
    sourceSessionId: sessionId,
    outcome: 'cancelled',
  })
  await expect(coordinator.navigateSessionTree(sessionId, 'active-entry')).resolves.toBeNull()
  expect(activeLeafId).toBe('historical-entry')

  await expect(
    coordinator.compactSession(sessionId, 'Keep decisions and unresolved work.'),
  ).resolves.toMatchObject({
    tree: { activeLeafId: 'compaction-entry', selectedEntryId: 'compaction-entry' },
  })
  expect(compactSession).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'compact',
      sourceSessionId: sessionId,
      customInstructions: 'Keep decisions and unresolved work.',
      activeLeafId: 'historical-entry',
      sourcePiSessionPath: '/sessions/session-id/source.jsonl',
    }),
  )
  expect(setPiSessionActiveLeaf).toHaveBeenLastCalledWith(sessionId, 'compaction-entry')

  let resolveCancelled!: (value: Awaited<ReturnType<RuntimeHost['compactSession']>>) => void
  compactSession.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveCancelled = resolve
      }),
  )
  const cancelling = coordinator.compactSession(sessionId, null)
  await vi.waitFor(() => expect(compactSession).toHaveBeenCalledTimes(2))
  const pendingConfig = compactSession.mock.calls[1]![0]
  expect(coordinator.cancelSessionOperation(sessionId)).toBe(true)
  expect(abortSessionOperation).toHaveBeenCalledWith(pendingConfig.operationId)
  resolveCancelled({
    type: 'host.compactResult',
    operationId: pendingConfig.operationId,
    sourceSessionId: sessionId,
    outcome: 'cancelled',
  })
  await expect(cancelling).resolves.toBeNull()

  navigateSession.mockResolvedValueOnce({
    type: 'host.navigateResult',
    operationId: '41234567-89ab-4def-8123-456789abcdef',
    sourceSessionId: sessionId,
    outcome: 'completed',
    activeLeafId: null,
    editorText: 'Root user task',
    summaryCreated: false,
  })
  await expect(
    coordinator.navigateSessionTree(sessionId, 'root-user-entry'),
  ).resolves.toMatchObject({ editorText: 'Root user task', summaryCreated: false })
  expect(setPiSessionActiveLeaf).toHaveBeenLastCalledWith(sessionId, null)

  await expect(
    coordinator.labelSessionEntry(sessionId, 'historical-entry', 'checkpoint'),
  ).resolves.toMatchObject({ session: { id: sessionId } })
  expect(labelSessionEntry).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'label',
      entryId: 'historical-entry',
      label: 'checkpoint',
    }),
  )
  expect(setPiSessionActiveLeaf).toHaveBeenLastCalledWith(sessionId, 'label-entry')
})

it('keeps the selected GUI context aligned with the opened Pi Session', async () => {
  const now = new Date().toISOString()
  const projectB: Project = {
    id: '21234567-89ab-4def-8123-456789abcdef',
    name: 'project-b',
    rootPath: '/project-b',
    trustedAt: now,
    availability: 'available',
    createdAt: now,
    updatedAt: now,
  }
  const sessionB: SessionRecord = {
    schemaVersion: 1,
    id: '31234567-89ab-4def-8123-456789abcdef',
    projectId: projectB.id,
    title: 'Session B',
    messages: [],
    runs: [],
    createdAt: now,
    updatedAt: now,
  }
  const repository: RuntimePersistence = {
    selectContext: vi.fn(async () => undefined),
    getSelectedContext: vi.fn(() => ({ projectId: projectB.id, sessionId: sessionB.id })),
    removeProject: vi.fn(async () => undefined),
    deleteSession: vi.fn(async () => undefined),
    getSession: vi.fn(async () => sessionB),
    getSessionHistory: vi.fn(
      () =>
        ({
          authority: 'pi-jsonl',
          piSessionId: 'pi-session-b',
          piSessionPath: '/sessions/project-b.jsonl',
          legacyImport: { status: 'not-required', sourceFile: null },
        }) satisfies SessionHistoryState,
    ),
    inspectSessionHistory: vi.fn(async () => historyView(sessionB, null)),
    bindPiSession: vi.fn(async () => undefined),
    rebuildSessionProjection: vi.fn(async () => sessionB),
    setPiSessionActiveLeaf: vi.fn(async () => undefined),
    createDerivedSession: vi.fn(async () => {
      throw new Error('not used')
    }),
    createImportedSession: vi.fn(async () => {
      throw new Error('not used')
    }),
    getProject: vi.fn(() => projectB),
    getSettings: vi.fn(
      async () =>
        ({
          apiProtocol: 'responses',
          baseUrl: 'https://example.test/v1',
          modelId: 'test-model',
          reasoningEffort: null,
          temperature: null,
          maxOutputTokens: 64,
          hasApiKey: true,
        }) satisfies ModelSettings,
    ),
    getApiKey: vi.fn(async () => 'test-key'),
    getRuntimePaths: vi.fn(() => ({
      agentDirectory: '/agent',
      sessionDirectory: '/sessions',
      resumeSession: true,
      piSessionPath: '/sessions/project-b.jsonl',
    })),
    saveSession: vi.fn(async () => undefined),
  }
  const openSession = vi.fn(async () => undefined)
  const closeSession = vi.fn(async () => undefined)
  const reloadResources = vi.fn(async () => undefined)
  const supervisor: RuntimeHost = {
    openSession,
    closeSession,
    start: vi.fn(async () => undefined),
    fork: vi.fn(async () => {
      throw new Error('not used')
    }),
    importSession: vi.fn(async () => {
      throw new Error('not used')
    }),
    exportSession: vi.fn(async () => {
      throw new Error('not used')
    }),
    navigateSession: vi.fn(async () => {
      throw new Error('not used')
    }),
    compactSession: vi.fn(async () => {
      throw new Error('not used')
    }),
    labelSessionEntry: vi.fn(async () => {
      throw new Error('not used')
    }),
    abortSessionOperation: vi.fn(),
    reloadResources,
    stop: vi.fn(),
    respondToExtensionUi: vi.fn(),
    queueMessage: vi.fn(),
    clearQueue: vi.fn(),
    isActive: vi.fn(() => false),
  }
  const coordinator = new RuntimeCoordinator(repository, supervisor, vi.fn())

  await coordinator.selectContext(projectB.id, sessionB.id)
  expect(openSession).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'session.open',
      sessionId: sessionB.id,
      projectRoot: projectB.rootPath,
    }),
  )
  expect(repository.selectContext).toHaveBeenCalledWith(projectB.id, sessionB.id)

  await coordinator.reloadSessionResources(sessionB.id)
  expect(reloadResources).toHaveBeenCalledWith(sessionB.id)

  await coordinator.selectContext(projectB.id, null)
  expect(closeSession).toHaveBeenCalledOnce()
  expect(repository.selectContext).toHaveBeenLastCalledWith(projectB.id, null)
})

it('closes and reopens the long-lived Pi Session around current Session and Project deletion', async () => {
  const now = new Date().toISOString()
  const projectA: Project = {
    id: '21234567-89ab-4def-8123-456789abcdef',
    name: 'project-a',
    rootPath: '/project-a',
    trustedAt: now,
    availability: 'available',
    createdAt: now,
    updatedAt: now,
  }
  const projectB: Project = {
    ...projectA,
    id: '31234567-89ab-4def-8123-456789abcdef',
    name: 'project-b',
    rootPath: '/project-b',
  }
  const sessionA1: SessionRecord = {
    schemaVersion: 1,
    id: '41234567-89ab-4def-8123-456789abcdef',
    projectId: projectA.id,
    title: 'Session A1',
    messages: [],
    runs: [],
    createdAt: now,
    updatedAt: now,
  }
  const sessionA2: SessionRecord = { ...sessionA1, id: '51234567-89ab-4def-8123-456789abcdef' }
  const sessionB: SessionRecord = {
    ...sessionA1,
    id: '61234567-89ab-4def-8123-456789abcdef',
    projectId: projectB.id,
    title: 'Session B',
  }
  const sessions = new Map([sessionA1, sessionA2, sessionB].map((session) => [session.id, session]))
  let selected = { projectId: projectA.id, sessionId: sessionA1.id }
  const steps: string[] = []
  const repository: RuntimePersistence = {
    selectContext: vi.fn(async (projectId, sessionId) => {
      selected = { projectId: projectId!, sessionId: sessionId! }
      steps.push(`select:${projectId}:${sessionId}`)
    }),
    getSelectedContext: vi.fn(() => selected),
    removeProject: vi.fn(async (projectId) => {
      expect(projectId).toBe(projectA.id)
      selected = { projectId: projectB.id, sessionId: sessionB.id }
      steps.push(`remove-project:${projectId}`)
    }),
    deleteSession: vi.fn(async (sessionId) => {
      expect(sessionId).toBe(sessionA1.id)
      selected = { projectId: projectA.id, sessionId: sessionA2.id }
      steps.push(`delete-session:${sessionId}`)
    }),
    getSession: vi.fn(async (sessionId) => sessions.get(sessionId)!),
    getSessionHistory: vi.fn((sessionId): SessionHistoryState => ({
      authority: 'pi-jsonl',
      piSessionId: `pi-${sessionId}`,
      piSessionPath: `/sessions/${sessionId}.jsonl`,
      legacyImport: { status: 'not-required', sourceFile: null },
    })),
    inspectSessionHistory: vi.fn(async (sessionId) => historyView(sessions.get(sessionId)!, null)),
    bindPiSession: vi.fn(async () => undefined),
    rebuildSessionProjection: vi.fn(async (sessionId) => sessions.get(sessionId)!),
    setPiSessionActiveLeaf: vi.fn(async () => undefined),
    createDerivedSession: vi.fn(async () => {
      throw new Error('not used')
    }),
    createImportedSession: vi.fn(async () => {
      throw new Error('not used')
    }),
    getProject: vi.fn((projectId) => (projectId === projectA.id ? projectA : projectB)),
    getSettings: vi.fn(
      async () =>
        ({
          apiProtocol: 'responses',
          baseUrl: 'https://example.test/v1',
          modelId: 'test-model',
          reasoningEffort: null,
          temperature: null,
          maxOutputTokens: null,
          hasApiKey: true,
        }) satisfies ModelSettings,
    ),
    getApiKey: vi.fn(async () => 'test-key'),
    getRuntimePaths: vi.fn((_projectId, sessionId) => ({
      agentDirectory: '/agent',
      sessionDirectory: '/sessions',
      resumeSession: true,
      piSessionPath: `/sessions/${sessionId}.jsonl`,
    })),
    saveSession: vi.fn(async () => undefined),
  }
  const openSession = vi.fn(async (config) => {
    steps.push(`open:${config.sessionId}`)
  })
  const closeSession = vi.fn(async () => {
    steps.push('close')
  })
  const supervisor: RuntimeHost = {
    openSession,
    closeSession,
    isActive: vi.fn(() => false),
    start: vi.fn(async () => undefined),
    fork: vi.fn(async () => {
      throw new Error('not used')
    }),
    importSession: vi.fn(async () => {
      throw new Error('not used')
    }),
    exportSession: vi.fn(async () => {
      throw new Error('not used')
    }),
    navigateSession: vi.fn(async () => {
      throw new Error('not used')
    }),
    compactSession: vi.fn(async () => {
      throw new Error('not used')
    }),
    labelSessionEntry: vi.fn(async () => {
      throw new Error('not used')
    }),
    abortSessionOperation: vi.fn(),
    reloadResources: vi.fn(async () => undefined),
    stop: vi.fn(),
    respondToExtensionUi: vi.fn(),
    queueMessage: vi.fn(),
    clearQueue: vi.fn(),
  }
  const coordinator = new RuntimeCoordinator(repository, supervisor, vi.fn())

  await coordinator.deleteSession(sessionA1.id)
  expect(steps).toEqual([
    'close',
    `delete-session:${sessionA1.id}`,
    `open:${sessionA2.id}`,
    `select:${projectA.id}:${sessionA2.id}`,
  ])

  steps.length = 0
  await coordinator.removeProject(projectA.id)
  expect(steps).toEqual([
    'close',
    `remove-project:${projectA.id}`,
    `open:${sessionB.id}`,
    `select:${projectB.id}:${sessionB.id}`,
  ])
  expect(closeSession).toHaveBeenCalledTimes(2)
  expect(openSession).toHaveBeenCalledTimes(2)
})

it('creates the replacement target Project from Pi cwd instead of reusing the source Project', async () => {
  const now = new Date().toISOString()
  const sourceProject: Project = {
    id: projectId,
    name: 'source',
    rootPath: '/source',
    trustedAt: now,
    availability: 'available',
    createdAt: now,
    updatedAt: now,
  }
  const targetProject: Project = {
    ...sourceProject,
    id: '21234567-89ab-4def-8123-456789abcdef',
    name: 'target',
    rootPath: '/target',
  }
  const source: SessionRecord = {
    schemaVersion: 1,
    id: sessionId,
    projectId: sourceProject.id,
    title: 'Source',
    messages: [],
    runs: [],
    createdAt: now,
    updatedAt: now,
  }
  const targetSummary: SessionSummary = {
    id: '31234567-89ab-4def-8123-456789abcdef',
    projectId: targetProject.id,
    title: 'Target (Session)',
    lastRunStatus: null,
    historyAuthority: 'pi-jsonl',
    createdAt: now,
    updatedAt: now,
  }
  const prepareSessionReplacement = vi.fn(async () => undefined)
  const ensureProjectByPath = vi.fn(async () => targetProject)
  const commitSessionReplacement = vi.fn<
    NonNullable<RuntimePersistence['commitSessionReplacement']>
  >(async () => targetSummary)
  const repository: RuntimePersistence = {
    getSelectedContext: vi.fn(() => ({ projectId, sessionId })),
    removeProject: vi.fn(async () => undefined),
    deleteSession: vi.fn(async () => undefined),
    getSession: vi.fn(async () => source),
    getSessionHistory: vi.fn(
      () =>
        ({
          authority: 'pi-jsonl',
          piSessionId: 'source-pi-session',
          piSessionPath: '/source/source.jsonl',
          legacyImport: { status: 'not-required', sourceFile: null },
        }) satisfies SessionHistoryState,
    ),
    inspectSessionHistory: vi.fn(async () => historyView(source, null)),
    bindPiSession: vi.fn(async () => undefined),
    rebuildSessionProjection: vi.fn(async () => source),
    setPiSessionActiveLeaf: vi.fn(async () => undefined),
    createDerivedSession: vi.fn(async () => targetSummary),
    createImportedSession: vi.fn(async () => targetSummary),
    commitSessionReplacement,
    prepareSessionReplacement,
    ensureProjectByPath,
    findSessionByPiSessionPath: vi.fn(async () => null),
    getProject: vi.fn(() => sourceProject),
    getSettings: vi.fn(async () => null),
    getApiKey: vi.fn(async () => null),
    getRuntimePaths: vi.fn(() => ({
      agentDirectory: '/agent',
      sessionDirectory: '/sessions',
      resumeSession: false,
    })),
    saveSession: vi.fn(async () => undefined),
  }
  const supervisor: RuntimeHost = {
    start: vi.fn(async () => undefined),
    fork: vi.fn(async () => {
      throw new Error('not used')
    }),
    importSession: vi.fn(async () => {
      throw new Error('not used')
    }),
    exportSession: vi.fn(async () => {
      throw new Error('not used')
    }),
    navigateSession: vi.fn(async () => {
      throw new Error('not used')
    }),
    compactSession: vi.fn(async () => {
      throw new Error('not used')
    }),
    labelSessionEntry: vi.fn(async () => {
      throw new Error('not used')
    }),
    abortSessionOperation: vi.fn(),
    reloadResources: vi.fn(async () => undefined),
    stop: vi.fn(),
    respondToExtensionUi: vi.fn(),
    queueMessage: vi.fn(),
    clearQueue: vi.fn(),
    isActive: vi.fn(() => false),
  }
  const coordinator = new RuntimeCoordinator(repository, supervisor, vi.fn())
  const operationId = '41234567-89ab-4def-8123-456789abcdef'
  const requestedTargetSessionId = '51234567-89ab-4def-8123-456789abcdef'

  const prepared = await coordinator.handleSessionReplacementRequest({
    type: 'session.replacement.requested',
    operationId,
    phase: 'prepare',
    kind: 'switch',
    sourceSessionId: source.id,
    targetSessionId: requestedTargetSessionId,
    targetSessionPath: '/target/external.jsonl',
    piSessionId: null,
    piSessionPath: null,
    cwd: null,
    sourcePiSessionPath: '/source/source.jsonl',
  })
  expect(prepared).toEqual({ accepted: true, targetSessionId: requestedTargetSessionId })
  expect(prepareSessionReplacement).toHaveBeenCalledOnce()

  await expect(
    coordinator.handleSessionReplacementRequest({
      type: 'session.replacement.requested',
      operationId,
      phase: 'commit',
      kind: 'switch',
      sourceSessionId: source.id,
      targetSessionId: requestedTargetSessionId,
      targetSessionPath: null,
      piSessionId: 'target-pi-session',
      piSessionPath: '/target/external.jsonl',
      cwd: targetProject.rootPath,
      sourcePiSessionPath: '/source/source.jsonl',
    }),
  ).resolves.toEqual({ accepted: true })
  expect(ensureProjectByPath).toHaveBeenCalledWith(targetProject.rootPath)
  expect(commitSessionReplacement).toHaveBeenCalledWith(
    operationId,
    source.id,
    requestedTargetSessionId,
    'switch',
    { id: 'target-pi-session', path: '/target/external.jsonl' },
    targetProject.id,
    targetProject.rootPath,
  )
})
