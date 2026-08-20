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
      piSessionFile: null,
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
      getSession: vi.fn(async () => session),
      getSessionHistory: vi.fn(() => history),
      inspectSessionHistory: vi.fn(async () => historyView(session, null)),
      bindPiSession: vi.fn(async (_sessionId, identity) => {
        history = {
          authority: 'pi-jsonl',
          piSessionId: identity.id,
          piSessionFile: identity.file,
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
        piSessionFile: 'session.jsonl',
        activeLeafId: 'persisted-active-leaf',
        runtimePreferences: {
          thinkingLevel: 'high',
          activeTools: ['pictor_read'],
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
      abortSessionOperation: vi.fn(),
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
        sessionName: expect.stringContaining('prompt'),
        piSessionFile: 'session.jsonl',
        activeLeafId: 'persisted-active-leaf',
        runtimePreferences: expect.objectContaining({ thinkingLevel: 'high' }),
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
        file: 'session.jsonl',
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
    abortSessionOperation: vi.fn(),
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
    abortSessionOperation: vi.fn(),
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
    getSession: vi.fn(async () => session),
    getSessionHistory: vi.fn(
      () =>
        ({
          authority: 'pi-jsonl',
          piSessionId: 'source-pi-session',
          piSessionFile: 'source.jsonl',
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
    piSessionFile: 'forked.jsonl',
  }))
  const importSession = vi.fn<RuntimeHost['importSession']>(async (config) => ({
    type: 'host.importResult',
    operationId: config.operationId,
    targetSessionId: config.targetSessionId,
    outcome: 'completed',
    piSessionId: 'imported-pi-session',
    piSessionFile: 'source-history.jsonl',
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
  const abortSessionOperation = vi.fn()
  const supervisor: RuntimeHost = {
    isActive: () => false,
    start: vi.fn(async () => undefined),
    fork,
    importSession,
    exportSession,
    navigateSession,
    compactSession,
    abortSessionOperation,
    approve: vi.fn(),
    reject: vi.fn(),
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
      sourceSessionDirectory: `/sessions/${sessionId}`,
      sourcePiSessionFile: 'source.jsonl',
      targetSessionDirectory: expect.stringMatching(/^\/sessions\//),
    }),
  )
  const forkConfig = fork.mock.calls[0]![0]
  expect(createDerivedSession).toHaveBeenCalledWith(sessionId, forkConfig.targetSessionId, 'fork', {
    id: 'forked-pi-session',
    file: 'forked.jsonl',
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
      file: 'forked.jsonl',
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
    { id: 'imported-pi-session', file: 'source-history.jsonl' },
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
      sourceSessionDirectory: `/sessions/${sessionId}`,
      sourcePiSessionFile: 'source.jsonl',
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
      sourceSessionDirectory: `/sessions/${sessionId}`,
      sourcePiSessionFile: 'source.jsonl',
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
      sourcePiSessionFile: 'source.jsonl',
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
})
