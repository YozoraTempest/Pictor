import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SessionHistoryView, SessionRecord } from '../../shared/domain'
import type { AppSnapshot, IpcResult, RuntimeEvent } from '../../shared/desktop-bridge'
import { useWorkspaceController, type WorkspaceBridge } from './use-workspace-controller'

const projectId = '11111111-1111-4111-8111-111111111111'
const firstSessionId = '22222222-2222-4222-8222-222222222222'
const secondSessionId = '33333333-3333-4333-8333-333333333333'
const runId = '44444444-4444-4444-8444-444444444444'
const messageId = '55555555-5555-4555-8555-555555555555'
const toolId = '66666666-6666-4666-8666-666666666666'
const now = '2026-08-11T00:00:00.000Z'

function ok<T>(value: T): IpcResult<T> {
  return { ok: true, value }
}

function failure<T>(message: string): IpcResult<T> {
  return { ok: false, error: { code: 'persistence-failed', message } }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function createSession(
  id: string,
  options: {
    title?: string
    runStatus?: SessionRecord['runs'][number]['status']
    messageContent?: string
    toolOutput?: string | null
    usage?: {
      tokens: {
        input: number
        output: number
        cacheRead: number
        cacheWrite: number
        total: number
      }
      cost: number
      context: null
    }
  } = {},
): SessionRecord {
  const runStatus = options.runStatus
  return {
    schemaVersion: 1,
    id,
    projectId,
    title: options.title ?? id,
    usage: options.usage,
    messages:
      options.messageContent === undefined
        ? []
        : [
            {
              id: messageId,
              role: 'assistant',
              content: options.messageContent,
              status: 'streaming',
              createdAt: now,
              updatedAt: now,
            },
          ],
    runs: runStatus
      ? [
          {
            id: runId,
            status: runStatus,
            error: null,
            toolEvents:
              options.toolOutput === undefined
                ? []
                : [
                    {
                      id: toolId,
                      callId: 'call-1',
                      kind: 'command',
                      label: 'test',
                      path: null,
                      command: null,
                      status: 'running',
                      output: options.toolOutput,
                      createdAt: now,
                      updatedAt: now,
                    },
                  ],
            createdAt: now,
            updatedAt: now,
          },
        ]
      : [],
    createdAt: now,
    updatedAt: now,
  }
}

function createSnapshot(
  selectedSessionId: string | null = firstSessionId,
  lastRunStatus: AppSnapshot['sessions'][number]['lastRunStatus'] = null,
  historyAuthority?: AppSnapshot['sessions'][number]['historyAuthority'],
): AppSnapshot {
  return {
    projects: [
      {
        id: projectId,
        name: 'Pictor',
        rootPath: 'E:\\code\\Pictor',
        trustedAt: now,
        availability: 'available',
        createdAt: now,
        updatedAt: now,
      },
    ],
    sessions: [firstSessionId, secondSessionId].map((id) => ({
      id,
      projectId,
      title: id,
      lastRunStatus: id === selectedSessionId ? lastRunStatus : null,
      ...(id === selectedSessionId && historyAuthority ? { historyAuthority } : {}),
      createdAt: now,
      updatedAt: now,
    })),
    selectedProjectId: projectId,
    selectedSessionId,
    settings: {
      apiProtocol: 'responses',
      baseUrl: 'https://example.test/v1',
      modelId: 'test-model',
      reasoningEffort: null,
      temperature: null,
      maxOutputTokens: null,
      hasApiKey: true,
    },
    issues: [],
  }
}

function createBridge(
  options: {
    snapshot?: AppSnapshot
    sessions?: Record<string, SessionRecord>
    onRuntimeListener?: (listener: (event: RuntimeEvent) => void) => void
  } = {},
): WorkspaceBridge & {
  getSnapshot: ReturnType<typeof vi.fn>
  getSession: ReturnType<typeof vi.fn>
  inspectSessionHistory: ReturnType<typeof vi.fn>
  forkSession: ReturnType<typeof vi.fn>
  startRun: ReturnType<typeof vi.fn>
  stopRun: ReturnType<typeof vi.fn>
  approveCommand: ReturnType<typeof vi.fn>
  rejectCommand: ReturnType<typeof vi.fn>
} {
  let snapshot = options.snapshot ?? createSnapshot()
  const sessions = options.sessions ?? {
    [firstSessionId]: createSession(firstSessionId),
    [secondSessionId]: createSession(secondSessionId),
  }
  const getSnapshot = vi.fn(async () => ok(snapshot))
  const getSession = vi.fn(async ({ sessionId }: { sessionId: string }) => {
    const session = sessions[sessionId]
    return session ? ok(session) : failure<SessionRecord>('不存在')
  })
  const inspectSessionHistory = vi.fn(
    async ({ sessionId }: { sessionId: string; entryId: string | null }) => {
      const session = sessions[sessionId]
      return session
        ? ok({ session, tree: null } satisfies SessionHistoryView)
        : failure<SessionHistoryView>('不存在')
    },
  )
  const startRun = vi.fn(async () => ok({ runId }))
  const forkSession = vi.fn(async () => ok(null))
  const stopRun = vi.fn(async () => ok(null))
  const approveCommand = vi.fn(async () => ok(null))
  const rejectCommand = vi.fn(async () => ok(null))

  return {
    getSnapshot,
    pickProjectDirectory: async () => ok(null),
    registerProject: async () => ok(snapshot.projects[0]!),
    relinkProject: async () => ok(snapshot.projects[0]!),
    removeProject: async () => ok(null),
    selectContext: async ({ projectId: nextProjectId, sessionId }) => {
      snapshot = {
        ...snapshot,
        selectedProjectId: nextProjectId,
        selectedSessionId: sessionId,
      }
      return ok(null)
    },
    createSession: async () => ok(snapshot.sessions[0]!),
    renameSession: async () => ok(snapshot.sessions[0]!),
    deleteSession: async () => ok(null),
    getSession,
    inspectSessionHistory,
    forkSession,
    startRun,
    queueRuntimeMessage: async () => ok(null),
    clearRuntimeQueue: async () => ok(null),
    approveCommand,
    rejectCommand,
    stopRun,
    onRuntimeEvent: (listener) => {
      options.onRuntimeListener?.(listener)
      return () => undefined
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useWorkspaceController', () => {
  it('initializes the selected workspace through its narrow bridge', async () => {
    const session = createSession(firstSessionId, { title: 'Selected session' })
    const bridge = createBridge({ sessions: { [firstSessionId]: session } })
    const { result } = renderHook(() => useWorkspaceController(bridge))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.snapshot).toEqual(createSnapshot())
    expect(result.current.selectedProject?.name).toBe('Pictor')
    expect(result.current.session).toEqual(session)
    expect(bridge.getSnapshot).toHaveBeenCalledOnce()
    expect(bridge.getSession).toHaveBeenCalledWith({ sessionId: firstSessionId })
  })

  it('exposes a readable initialization failure', async () => {
    const bridge = createBridge()
    bridge.getSnapshot.mockResolvedValue(failure<AppSnapshot>('无法读取工作区'))
    const { result } = renderHook(() => useWorkspaceController(bridge))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.snapshot).toBeNull()
    expect(result.current.loadError).toBe('无法读取工作区')
  })

  it('keeps a Legacy Session Import visible but read-only', async () => {
    const legacy = createSession(firstSessionId, { title: 'Legacy history' })
    const bridge = createBridge({
      snapshot: createSnapshot(firstSessionId, null, 'legacy-import'),
      sessions: { [firstSessionId]: legacy },
    })
    const { result } = renderHook(() => useWorkspaceController(bridge))
    await waitFor(() => expect(result.current.session).toEqual(legacy))

    expect(result.current.disabledReason).toContain('旧版会话是只读历史')
    act(() => result.current.setDraft('must not run'))
    await act(async () => result.current.startRun())
    expect(bridge.startRun).not.toHaveBeenCalled()
  })

  it('does not let an older Session selection overwrite the latest selection', async () => {
    const snapshot = createSnapshot(null)
    const firstLoad = deferred<IpcResult<SessionRecord>>()
    const secondLoad = deferred<IpcResult<SessionRecord>>()
    const firstSnapshot = deferred<IpcResult<AppSnapshot>>()
    const secondSnapshot = deferred<IpcResult<AppSnapshot>>()
    const bridge = createBridge({ snapshot })
    bridge.getSession
      .mockImplementationOnce(() => firstLoad.promise)
      .mockImplementationOnce(() => secondLoad.promise)
    bridge.getSnapshot
      .mockResolvedValueOnce(ok(snapshot))
      .mockImplementationOnce(() => firstSnapshot.promise)
      .mockImplementationOnce(() => secondSnapshot.promise)
    const { result } = renderHook(() => useWorkspaceController(bridge))
    await waitFor(() => expect(result.current.loading).toBe(false))

    let firstSelection!: Promise<void>
    act(() => {
      firstSelection = result.current.selectSession(projectId, firstSessionId)
    })
    await waitFor(() => expect(bridge.getSession).toHaveBeenCalledTimes(1))
    let secondSelection!: Promise<void>
    act(() => {
      secondSelection = result.current.selectSession(projectId, secondSessionId)
    })
    await waitFor(() => expect(bridge.getSession).toHaveBeenCalledTimes(2))

    await act(async () => {
      secondLoad.resolve(ok(createSession(secondSessionId, { title: 'Latest session' })))
      secondSnapshot.resolve(ok(createSnapshot(secondSessionId)))
      await secondSelection
    })
    await act(async () => {
      firstLoad.resolve(ok(createSession(firstSessionId, { title: 'Stale session' })))
      firstSnapshot.resolve(ok(createSnapshot(firstSessionId)))
      await firstSelection
    })

    expect(result.current.selectedSessionId).toBe(secondSessionId)
    expect(result.current.session).toMatchObject({ id: secondSessionId, title: 'Latest session' })
  })

  it('applies deltas to the current Session and ignores another Session', async () => {
    let runtimeListener: ((event: RuntimeEvent) => void) | null = null
    const session = createSession(firstSessionId, {
      runStatus: 'running',
      messageContent: 'Hello',
      toolOutput: null,
    })
    const bridge = createBridge({
      snapshot: createSnapshot(firstSessionId, 'running'),
      sessions: { [firstSessionId]: session },
      onRuntimeListener: (listener) => {
        runtimeListener = listener
      },
    })
    const { result } = renderHook(() => useWorkspaceController(bridge))
    await waitFor(() => expect(result.current.session).toEqual(session))
    if (!runtimeListener) throw new Error('Runtime listener was not registered')

    act(() => {
      runtimeListener?.({
        type: 'message.delta',
        runId,
        sessionId: firstSessionId,
        messageId,
        delta: ' world',
        at: now,
      })
      runtimeListener?.({
        type: 'tool.updated',
        runId,
        sessionId: firstSessionId,
        callId: 'call-1',
        output: 'updated output',
        at: now,
      })
      runtimeListener?.({
        type: 'message.delta',
        runId,
        sessionId: secondSessionId,
        messageId,
        delta: ' ignored',
        at: now,
      })
    })

    expect(result.current.session?.messages[0]?.content).toBe('Hello world')
    expect(result.current.session?.runs[0]?.toolEvents[0]?.output).toBe('updated output')
    expect(bridge.getSnapshot).toHaveBeenCalledOnce()
  })

  it('does not apply a newly selected Session event to the previously loaded Session', async () => {
    let runtimeListener: ((event: RuntimeEvent) => void) | null = null
    const nextLoad = deferred<IpcResult<SessionRecord>>()
    const bridge = createBridge({
      sessions: {
        [firstSessionId]: createSession(firstSessionId, { messageContent: 'First' }),
      },
      onRuntimeListener: (listener) => {
        runtimeListener = listener
      },
    })
    bridge.getSession
      .mockResolvedValueOnce(ok(createSession(firstSessionId, { messageContent: 'First' })))
      .mockImplementationOnce(() => nextLoad.promise)
    const { result } = renderHook(() => useWorkspaceController(bridge))
    await waitFor(() => expect(result.current.session?.id).toBe(firstSessionId))
    if (!runtimeListener) throw new Error('Runtime listener was not registered')

    let selection!: Promise<void>
    act(() => {
      selection = result.current.selectSession(projectId, secondSessionId)
    })
    await waitFor(() => expect(result.current.selectedSessionId).toBe(secondSessionId))
    act(() => {
      runtimeListener?.({
        type: 'message.delta',
        runId,
        sessionId: secondSessionId,
        messageId,
        delta: ' must not leak',
        at: now,
      })
    })
    expect(result.current.session?.messages[0]?.content).toBe('First')

    await act(async () => {
      nextLoad.resolve(ok(createSession(secondSessionId, { messageContent: 'Second' })))
      await selection
    })
    expect(result.current.session?.messages[0]?.content).toBe('Second')
  })

  it('keeps the terminal Runtime refresh when an older refresh resolves later', async () => {
    let runtimeListener: ((event: RuntimeEvent) => void) | null = null
    const running = createSession(firstSessionId, { runStatus: 'running' })
    const completed = createSession(firstSessionId, { runStatus: 'completed' })
    const staleRefresh = deferred<IpcResult<SessionRecord>>()
    const terminalRefresh = deferred<IpcResult<SessionRecord>>()
    const bridge = createBridge({
      snapshot: createSnapshot(firstSessionId, 'running'),
      sessions: { [firstSessionId]: running },
      onRuntimeListener: (listener) => {
        runtimeListener = listener
      },
    })
    bridge.getSession
      .mockResolvedValueOnce(ok(running))
      .mockImplementationOnce(() => staleRefresh.promise)
      .mockImplementationOnce(() => terminalRefresh.promise)
    const { result } = renderHook(() => useWorkspaceController(bridge))
    await waitFor(() => expect(result.current.session).toEqual(running))
    if (!runtimeListener) throw new Error('Runtime listener was not registered')

    act(() => {
      runtimeListener?.({
        type: 'message.completed',
        runId,
        sessionId: firstSessionId,
        messageId,
        content: 'Done',
        at: now,
      })
      runtimeListener?.({
        type: 'run.stateChanged',
        runId,
        sessionId: firstSessionId,
        status: 'completed',
        error: null,
        at: now,
      })
    })
    await waitFor(() => expect(bridge.getSession).toHaveBeenCalledTimes(3))

    await act(async () => terminalRefresh.resolve(ok(completed)))
    expect(result.current.activeRun?.status).toBe('completed')
    await act(async () => staleRefresh.resolve(ok(running)))
    expect(result.current.activeRun?.status).toBe('completed')
  })

  it('restores usage from the terminal Session Projection without a live usage event', async () => {
    let runtimeListener: ((event: RuntimeEvent) => void) | null = null
    const usage = {
      tokens: { input: 30, output: 13, cacheRead: 5, cacheWrite: 1, total: 49 },
      cost: 3.75,
      context: null,
    }
    const running = createSession(firstSessionId, { runStatus: 'running' })
    const completed = createSession(firstSessionId, { runStatus: 'completed', usage })
    const bridge = createBridge({
      snapshot: createSnapshot(firstSessionId, 'running'),
      sessions: { [firstSessionId]: running },
      onRuntimeListener: (listener) => {
        runtimeListener = listener
      },
    })
    bridge.getSession.mockResolvedValueOnce(ok(running)).mockResolvedValue(ok(completed))
    const { result } = renderHook(() => useWorkspaceController(bridge))
    await waitFor(() => expect(result.current.session).toEqual(running))
    if (!runtimeListener) throw new Error('Runtime listener was not registered')

    act(() => {
      runtimeListener?.({
        type: 'run.stateChanged',
        runId,
        sessionId: firstSessionId,
        status: 'completed',
        error: null,
        at: now,
      })
    })

    await waitFor(() => expect(result.current.activeRun?.status).toBe('completed'))
    expect(result.current.runtimeUsage).toEqual(usage)
  })

  it('inspects a historical tree entry read-only and returns to the active leaf', async () => {
    const active = createSession(firstSessionId, {
      messageContent: 'Active answer',
      runStatus: 'completed',
    })
    const historical = createSession(firstSessionId, {
      messageContent: 'Historical answer',
      runStatus: 'completed',
    })
    const tree = {
      activeLeafId: 'active-entry',
      selectedEntryId: 'historical-entry',
      nodes: [
        {
          id: 'historical-entry',
          parentId: null,
          kind: 'assistant' as const,
          label: 'Historical answer',
          timestamp: now,
          depth: 0,
          childCount: 0,
          isActivePath: false,
          isActiveLeaf: false,
          isSelected: true,
        },
        {
          id: 'active-entry',
          parentId: null,
          kind: 'assistant' as const,
          label: 'Active answer',
          timestamp: now,
          depth: 0,
          childCount: 0,
          isActivePath: true,
          isActiveLeaf: true,
          isSelected: false,
        },
      ],
    }
    const forked = createSession(secondSessionId, {
      title: 'Source session (Fork)',
      messageContent: 'Historical answer',
      runStatus: 'completed',
    })
    const bridge = createBridge({
      sessions: { [firstSessionId]: active, [secondSessionId]: forked },
    })
    bridge.inspectSessionHistory.mockImplementation(
      async ({ entryId }: { sessionId: string; entryId: string | null }) =>
        ok({
          session: entryId === 'historical-entry' ? historical : active,
          tree: {
            ...tree,
            selectedEntryId: entryId ?? 'active-entry',
            nodes: tree.nodes.map((node) => ({
              ...node,
              isSelected: node.id === (entryId ?? 'active-entry'),
            })),
          },
        }),
    )
    const { result } = renderHook(() => useWorkspaceController(bridge))
    await waitFor(() => expect(result.current.session).toEqual(active))

    await act(async () => result.current.inspectSessionHistory('historical-entry'))
    expect(result.current.session?.messages[0]?.content).toBe('Historical answer')
    expect(result.current.sessionTree?.selectedEntryId).toBe('historical-entry')
    expect(result.current.disabledReason).toContain('历史分支')

    bridge.forkSession.mockResolvedValueOnce(
      ok({
        id: secondSessionId,
        projectId,
        title: 'Source session (Fork)',
        lastRunStatus: 'completed',
        historyAuthority: 'pi-jsonl',
        createdAt: now,
        updatedAt: now,
      }),
    )
    await act(async () => result.current.forkSession('historical-entry'))
    expect(bridge.forkSession).toHaveBeenCalledWith({
      sessionId: firstSessionId,
      entryId: 'historical-entry',
    })
    expect(result.current.selectedSessionId).toBe(secondSessionId)
    expect(result.current.session?.title).toBe('Source session (Fork)')

    await act(async () => result.current.selectSession(projectId, firstSessionId))
    await act(async () => result.current.inspectSessionHistory(null))
    expect(result.current.session?.messages[0]?.content).toBe('Active answer')
    expect(result.current.sessionTree?.selectedEntryId).toBe('active-entry')
    expect(result.current.disabledReason).toBeNull()
  })

  it('coordinates Run intents and reports bridge failures', async () => {
    const idle = createSession(firstSessionId)
    const running = createSession(firstSessionId, { runStatus: 'running' })
    const bridge = createBridge({ sessions: { [firstSessionId]: idle } })
    bridge.startRun
      .mockResolvedValueOnce(failure<{ runId: string }>('启动失败'))
      .mockResolvedValueOnce(ok({ runId }))
    bridge.getSession.mockResolvedValueOnce(ok(idle)).mockResolvedValue(ok(running))
    bridge.stopRun.mockResolvedValue(failure<null>('停止失败'))
    bridge.rejectCommand.mockResolvedValue(failure<null>('拒绝失败'))
    const { result } = renderHook(() => useWorkspaceController(bridge))
    await waitFor(() => expect(result.current.session).toEqual(idle))

    act(() => result.current.setDraft('  run this  '))
    await act(async () => result.current.startRun())
    expect(bridge.startRun).toHaveBeenCalledWith({ sessionId: firstSessionId, prompt: 'run this' })
    expect(result.current.actionError).toBe('启动失败')

    await act(async () => result.current.startRun())
    expect(result.current.draft).toBe('')
    expect(result.current.activeRun?.status).toBe('running')

    await act(async () => result.current.stopRun(runId))
    expect(result.current.activeRun?.status).toBe('stopping')
    expect(result.current.actionError).toBe('停止失败')

    await act(async () => result.current.resolveApproval(runId, 'call-1', true))
    expect(bridge.approveCommand).toHaveBeenCalledWith({ runId, callId: 'call-1' })
    await act(async () => result.current.resolveApproval(runId, 'call-1', false))
    expect(bridge.rejectCommand).toHaveBeenCalledWith({ runId, callId: 'call-1' })
    expect(result.current.actionError).toBe('拒绝失败')
    expect(result.current.approvalBusyCallId).toBeNull()
  })
})
