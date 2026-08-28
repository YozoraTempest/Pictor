import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type {
  Project,
  ImageAttachment,
  RunRecord,
  SessionRecord,
  SessionSummary,
  SessionTreeView,
  UsageSnapshot,
} from '../../shared/domain'
import type {
  AppSnapshot,
  PictorBridge,
  ProjectCandidate,
  SessionExportFormat,
} from '../../shared/desktop-bridge'
import type { ModelSettings } from '../../shared/model'

const activeStatuses = new Set(['queued', 'running', 'awaiting-approval', 'stopping'])
type RuntimeUsage = UsageSnapshot

export type WorkspaceBridge = Pick<
  PictorBridge,
  | 'getSnapshot'
  | 'pickProjectDirectory'
  | 'registerProject'
  | 'relinkProject'
  | 'removeProject'
  | 'selectContext'
  | 'createSession'
  | 'renameSession'
  | 'deleteSession'
  | 'getSession'
  | 'inspectSessionHistory'
  | 'navigateSessionTree'
  | 'compactSession'
  | 'labelSessionEntry'
  | 'cancelSessionOperation'
  | 'forkSession'
  | 'cloneSession'
  | 'importSession'
  | 'exportSession'
  | 'startRun'
  | 'pickMessageImages'
  | 'stopRun'
  | 'queueRuntimeMessage'
  | 'clearRuntimeQueue'
  | 'syncComposerText'
  | 'onRuntimeEvent'
>

export interface WorkspaceTrustRequest {
  candidate: ProjectCandidate
  relinkProjectId: string | null
}

export interface WorkspaceController {
  snapshot: AppSnapshot | null
  projects: Project[]
  sessions: SessionSummary[]
  selectedProjectId: string | null
  selectedSessionId: string | null
  selectedProject: Project | null
  session: SessionRecord | null
  sessionTree: SessionTreeView | null
  sessionTreeLoading: boolean
  canInspectSessionTree: boolean
  navigatingEntryId: string | null
  forkingEntryId: string | null
  cloningSession: boolean
  importingProjectId: string | null
  exportingSession: { sessionId: string; format: SessionExportFormat } | null
  compactingSession: boolean
  runtimeCompactionReason: 'manual' | 'threshold' | 'overflow' | null
  activeSessionSummary: SessionSummary | null
  activeRun: RunRecord | null
  anotherSessionRunning: boolean
  draft: string
  draftImages: ImageAttachment[]
  disabledReason: string | null
  loading: boolean
  sessionLoading: boolean
  loadError: string | null
  actionError: string | null
  queuedMessages: { steering: number; followUp: number }
  runtimeUsage: RuntimeUsage | null
  selectProject: (projectId: string) => Promise<void>
  selectSession: (projectId: string, sessionId: string) => Promise<void>
  pickProject: (relinkProjectId?: string | null) => Promise<WorkspaceTrustRequest | null>
  trustProject: (request: WorkspaceTrustRequest) => Promise<boolean>
  createSession: (projectId: string) => Promise<void>
  removeProject: (projectId: string) => Promise<boolean>
  deleteSession: (sessionId: string) => Promise<boolean>
  renameSession: (sessionId: string, title: string) => Promise<boolean>
  inspectSessionHistory: (entryId: string | null) => Promise<void>
  navigateSessionTree: (
    entryId: string,
    options?: { summarize: boolean; customInstructions: string | null },
  ) => Promise<boolean>
  forkSession: (entryId: string) => Promise<boolean>
  cloneSession: () => Promise<boolean>
  importSession: (projectId: string) => Promise<boolean>
  exportSession: (sessionId: string, format: SessionExportFormat) => Promise<boolean>
  compactSession: (customInstructions: string | null) => Promise<boolean>
  labelSessionEntry: (entryId: string, label: string | null) => Promise<boolean>
  cancelSessionOperation: () => Promise<boolean>
  startRun: () => Promise<void>
  pickMessageImages: () => Promise<void>
  removeMessageImage: (index: number) => void
  queueMessage: (mode: 'steer' | 'follow-up') => Promise<void>
  clearQueue: () => Promise<void>
  stopRun: (runId: string) => Promise<void>
  setDraft: (value: string) => void
  applySettings: (settings: ModelSettings) => void
  reportActionError: (message: string) => void
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message)
  return '操作失败，请稍后重试'
}

export function useWorkspaceController(bridge: WorkspaceBridge): WorkspaceController {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [session, setSession] = useState<SessionRecord | null>(null)
  const [sessionTree, setSessionTree] = useState<SessionTreeView | null>(null)
  const [sessionTreeLoading, setSessionTreeLoading] = useState(false)
  const [sessionOperation, setSessionOperation] = useState<
    | { kind: 'fork'; entryId: string }
    | { kind: 'navigate'; entryId: string }
    | { kind: 'clone' }
    | { kind: 'import'; projectId: string }
    | { kind: 'export'; sessionId: string; format: SessionExportFormat }
    | { kind: 'compact'; sessionId: string }
    | null
  >(null)
  const [loading, setLoading] = useState(true)
  const [sessionLoading, setSessionLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [draftImages, setDraftImages] = useState<Record<string, ImageAttachment[]>>({})
  const [queuedMessages, setQueuedMessages] = useState({ steering: 0, followUp: 0 })
  const [runtimeUsage, setRuntimeUsage] = useState<RuntimeUsage | null>(null)
  const [runtimeCompactionReason, setRuntimeCompactionReason] = useState<
    'manual' | 'threshold' | 'overflow' | null
  >(null)
  const sessionRequestId = useRef(0)
  const snapshotRequestId = useRef(0)
  const navigationRequestId = useRef(0)
  const selectedSessionIdRef = useRef<string | null>(null)

  const updateSelectedSessionId = useCallback((value: string | null) => {
    selectedSessionIdRef.current = value
    setSelectedSessionId(value)
  }, [])

  const applySnapshot = useCallback(
    (value: AppSnapshot) => {
      setSnapshot(value)
      setSelectedProjectId(value.selectedProjectId)
      updateSelectedSessionId(value.selectedSessionId)
    },
    [updateSelectedSessionId],
  )

  const refreshSnapshot = useCallback(async (): Promise<AppSnapshot | null> => {
    const requestId = ++snapshotRequestId.current
    const response = await bridge.getSnapshot()
    if (!response.ok) throw response.error
    if (requestId !== snapshotRequestId.current) return null
    applySnapshot(response.value)
    return response.value
  }, [applySnapshot, bridge])

  const loadSession = useCallback(
    async (sessionId: string | null, showLoading = true): Promise<void> => {
      const requestId = ++sessionRequestId.current
      if (!sessionId) {
        setSession(null)
        setSessionTree(null)
        setSessionTreeLoading(false)
        setRuntimeUsage(null)
        setSessionLoading(false)
        return
      }
      if (showLoading) setSessionLoading(true)
      const response = await bridge.getSession({ sessionId })
      if (requestId !== sessionRequestId.current) return
      if (response.ok) {
        setSession(response.value)
        setSessionTree(null)
        setRuntimeUsage(response.value.usage ?? null)
        setActionError(null)
      } else {
        setSession(null)
        setSessionTree(null)
        setRuntimeUsage(null)
        setActionError(response.error.message)
      }
      setSessionLoading(false)
    },
    [bridge],
  )

  const inspectSessionHistory = useCallback(
    async (entryId: string | null): Promise<void> => {
      const sessionId = selectedSessionIdRef.current
      if (!sessionId) return
      const requestId = ++sessionRequestId.current
      setSessionTreeLoading(true)
      const response = await bridge.inspectSessionHistory({ sessionId, entryId })
      if (requestId !== sessionRequestId.current) return
      if (response.ok) {
        setSession(response.value.session)
        setSessionTree(response.value.tree)
        setRuntimeUsage(response.value.session.usage ?? null)
        setActionError(null)
      } else {
        setActionError(response.error.message)
      }
      setSessionTreeLoading(false)
    },
    [bridge],
  )

  const navigateSessionTree = useCallback(
    async (
      entryId: string,
      options: { summarize: boolean; customInstructions: string | null } = {
        summarize: false,
        customInstructions: null,
      },
    ): Promise<boolean> => {
      const sourceSessionId = selectedSessionIdRef.current
      if (!sourceSessionId || sessionOperation) return false
      sessionRequestId.current += 1
      setSessionOperation({ kind: 'navigate', entryId })
      setSessionTreeLoading(true)
      setActionError(null)
      try {
        const response = await bridge.navigateSessionTree({
          sessionId: sourceSessionId,
          entryId,
          summarize: options.summarize,
          customInstructions: options.customInstructions,
        })
        if (!response.ok) {
          setActionError(response.error.message)
          return false
        }
        if (!response.value) return false
        setSession(response.value.history.session)
        setSessionTree(response.value.history.tree)
        setRuntimeUsage(response.value.history.session.usage ?? null)
        if (response.value.editorText !== null) {
          setDrafts((current) => ({ ...current, [sourceSessionId]: response.value!.editorText! }))
        }
        await refreshSnapshot().catch((error: unknown) => setActionError(errorMessage(error)))
        return true
      } catch (error) {
        setActionError(errorMessage(error))
        return false
      } finally {
        setSessionTreeLoading(false)
        setSessionOperation(null)
      }
    },
    [bridge, refreshSnapshot, sessionOperation],
  )

  useEffect(() => {
    let active = true
    void refreshSnapshot()
      .then((value) => {
        if (active && value) return loadSession(value.selectedSessionId)
      })
      .catch((error: unknown) => {
        if (active) setLoadError(errorMessage(error))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
      sessionRequestId.current += 1
      snapshotRequestId.current += 1
    }
  }, [loadSession, refreshSnapshot])

  useEffect(() => {
    if (loading) return
    return bridge.onRuntimeEvent((event) => {
      const currentSessionId = selectedSessionIdRef.current
      if (event.type === 'session.replaced') {
        void refreshSnapshot()
          .then((value) => {
            if (!value) return
            setSelectedProjectId(value.selectedProjectId)
            updateSelectedSessionId(value.selectedSessionId)
            return loadSession(value.selectedSessionId, false)
          })
          .catch((error: unknown) => setActionError(errorMessage(error)))
      } else if (event.sessionId === currentSessionId && event.type === 'message.delta') {
        setSession((current) =>
          current?.id === event.sessionId
            ? {
                ...current,
                messages: current.messages.map((message) =>
                  message.id === event.messageId
                    ? { ...message, content: message.content + event.delta, updatedAt: event.at }
                    : message,
                ),
              }
            : current,
        )
      } else if (event.sessionId === currentSessionId && event.type === 'tool.updated') {
        setSession((current) =>
          current?.id === event.sessionId
            ? {
                ...current,
                runs: current.runs.map((run) =>
                  run.id === event.runId
                    ? {
                        ...run,
                        toolEvents: run.toolEvents.map((tool) =>
                          tool.callId === event.callId
                            ? { ...tool, output: event.output, updatedAt: event.at }
                            : tool,
                        ),
                      }
                    : run,
                ),
              }
            : current,
        )
      } else if (event.sessionId === currentSessionId && event.type === 'queue.updated') {
        setQueuedMessages({
          steering: event.steering.length,
          followUp: event.followUp.length,
        })
      } else if (event.sessionId === currentSessionId && event.type === 'usage.updated') {
        setRuntimeUsage(event)
      } else if (event.sessionId === currentSessionId && event.type === 'compaction.stateChanged') {
        setRuntimeCompactionReason(event.status === 'running' ? event.reason : null)
        if (event.status === 'failed' && event.error) setActionError(event.error)
      } else if (event.type === 'extension.composer.changed') {
        setDrafts((current) => ({ ...current, [event.sessionId]: event.text }))
      } else if (event.sessionId === currentSessionId) {
        void loadSession(event.sessionId, false).catch((error: unknown) =>
          setActionError(errorMessage(error)),
        )
      }

      if (event.type !== 'message.delta' && event.type !== 'tool.updated') {
        void refreshSnapshot().catch((error: unknown) => setActionError(errorMessage(error)))
      }
    })
  }, [bridge, loadSession, loading, refreshSnapshot, updateSelectedSessionId])

  const selectProject = useCallback(
    async (projectId: string): Promise<void> => {
      const navigationId = ++navigationRequestId.current
      setActionError(null)
      sessionRequestId.current += 1
      snapshotRequestId.current += 1
      const response = await bridge.selectContext({ projectId, sessionId: null })
      if (navigationId !== navigationRequestId.current) return
      if (!response.ok) {
        setSessionLoading(false)
        setActionError(response.error.message)
        return
      }
      setSelectedProjectId(projectId)
      updateSelectedSessionId(null)
      setSession(null)
      setSessionLoading(false)
      await refreshSnapshot().catch((error: unknown) => setActionError(errorMessage(error)))
    },
    [bridge, refreshSnapshot, updateSelectedSessionId],
  )

  const selectSession = useCallback(
    async (projectId: string, sessionId: string): Promise<void> => {
      const navigationId = ++navigationRequestId.current
      sessionRequestId.current += 1
      snapshotRequestId.current += 1
      setActionError(null)
      setSelectedProjectId(projectId)
      updateSelectedSessionId(sessionId)
      setSessionLoading(true)
      const response = await bridge.selectContext({ projectId, sessionId })
      if (navigationId !== navigationRequestId.current) return
      if (!response.ok) {
        setSessionLoading(false)
        setActionError(response.error.message)
        return
      }
      await Promise.all([
        loadSession(sessionId),
        refreshSnapshot().catch((error: unknown) => setActionError(errorMessage(error))),
      ])
    },
    [bridge, loadSession, refreshSnapshot, updateSelectedSessionId],
  )

  const forkSession = useCallback(
    async (entryId: string): Promise<boolean> => {
      const sourceSessionId = selectedSessionIdRef.current
      if (!sourceSessionId || sessionOperation) return false
      setSessionOperation({ kind: 'fork', entryId })
      setActionError(null)
      try {
        const response = await bridge.forkSession({ sessionId: sourceSessionId, entryId })
        if (!response.ok) {
          setActionError(response.error.message)
          return false
        }
        if (!response.value) return false
        await selectSession(response.value.projectId, response.value.id)
        return true
      } catch (error) {
        setActionError(errorMessage(error))
        return false
      } finally {
        setSessionOperation(null)
      }
    },
    [bridge, selectSession, sessionOperation],
  )

  const cloneSession = useCallback(async (): Promise<boolean> => {
    const sourceSessionId = selectedSessionIdRef.current
    if (!sourceSessionId || sessionOperation) return false
    setSessionOperation({ kind: 'clone' })
    setActionError(null)
    try {
      const response = await bridge.cloneSession({ sessionId: sourceSessionId })
      if (!response.ok) {
        setActionError(response.error.message)
        return false
      }
      if (!response.value) return false
      await selectSession(response.value.projectId, response.value.id)
      return true
    } catch (error) {
      setActionError(errorMessage(error))
      return false
    } finally {
      setSessionOperation(null)
    }
  }, [bridge, selectSession, sessionOperation])

  const importSession = useCallback(
    async (projectId: string): Promise<boolean> => {
      if (sessionOperation) return false
      setSessionOperation({ kind: 'import', projectId })
      setActionError(null)
      try {
        const response = await bridge.importSession({ projectId })
        if (!response.ok) {
          setActionError(response.error.message)
          return false
        }
        if (!response.value) return false
        await selectSession(response.value.projectId, response.value.id)
        return true
      } catch (error) {
        setActionError(errorMessage(error))
        return false
      } finally {
        setSessionOperation(null)
      }
    },
    [bridge, selectSession, sessionOperation],
  )

  const exportSession = useCallback(
    async (sessionId: string, format: SessionExportFormat): Promise<boolean> => {
      if (sessionOperation) return false
      setSessionOperation({ kind: 'export', sessionId, format })
      setActionError(null)
      try {
        const response = await bridge.exportSession({ sessionId, format })
        if (!response.ok) {
          setActionError(response.error.message)
          return false
        }
        return response.value
      } catch (error) {
        setActionError(errorMessage(error))
        return false
      } finally {
        setSessionOperation(null)
      }
    },
    [bridge, sessionOperation],
  )

  const compactSession = useCallback(
    async (customInstructions: string | null): Promise<boolean> => {
      const sourceSessionId = selectedSessionIdRef.current
      if (!sourceSessionId || sessionOperation) return false
      setSessionOperation({ kind: 'compact', sessionId: sourceSessionId })
      setActionError(null)
      try {
        const response = await bridge.compactSession({
          sessionId: sourceSessionId,
          customInstructions,
        })
        if (!response.ok) {
          setActionError(response.error.message)
          return false
        }
        if (!response.value) return false
        setSession(response.value.session)
        setSessionTree(response.value.tree)
        setRuntimeUsage(response.value.session.usage ?? null)
        await refreshSnapshot().catch((error: unknown) => setActionError(errorMessage(error)))
        return true
      } catch (error) {
        setActionError(errorMessage(error))
        return false
      } finally {
        setSessionOperation(null)
      }
    },
    [bridge, refreshSnapshot, sessionOperation],
  )

  const labelSessionEntry = useCallback(
    async (entryId: string, label: string | null): Promise<boolean> => {
      const sessionId = selectedSessionIdRef.current
      if (!sessionId || sessionOperation) return false
      setActionError(null)
      const response = await bridge.labelSessionEntry({ sessionId, entryId, label })
      if (!response.ok) {
        setActionError(response.error.message)
        return false
      }
      setSession(response.value.session)
      setSessionTree(response.value.tree)
      await refreshSnapshot().catch((error: unknown) => setActionError(errorMessage(error)))
      return true
    },
    [bridge, refreshSnapshot, sessionOperation],
  )

  const cancelSessionOperation = useCallback(async (): Promise<boolean> => {
    const sessionId = selectedSessionIdRef.current
    if (
      !sessionId ||
      (sessionOperation?.kind !== 'compact' && sessionOperation?.kind !== 'navigate')
    )
      return false
    const response = await bridge.cancelSessionOperation({ sessionId })
    if (!response.ok) {
      setActionError(response.error.message)
      return false
    }
    return response.value
  }, [bridge, sessionOperation])

  const forkingEntryId = sessionOperation?.kind === 'fork' ? sessionOperation.entryId : null
  const navigatingEntryId = sessionOperation?.kind === 'navigate' ? sessionOperation.entryId : null
  const cloningSession = sessionOperation?.kind === 'clone'
  const importingProjectId = sessionOperation?.kind === 'import' ? sessionOperation.projectId : null
  const exportingSession =
    sessionOperation?.kind === 'export'
      ? { sessionId: sessionOperation.sessionId, format: sessionOperation.format }
      : null
  const compactingSession = sessionOperation?.kind === 'compact'

  const pickProject = useCallback(
    async (relinkProjectId: string | null = null): Promise<WorkspaceTrustRequest | null> => {
      setActionError(null)
      const response = await bridge.pickProjectDirectory()
      if (!response.ok) {
        setActionError(response.error.message)
        return null
      }
      if (!response.value) return null
      if (response.value.existingProjectId) {
        if (relinkProjectId && response.value.existingProjectId !== relinkProjectId) {
          setActionError('该目录已属于另一个项目，请选择不同目录')
          return null
        }
        await selectProject(response.value.existingProjectId)
        return null
      }
      return { candidate: response.value, relinkProjectId }
    },
    [bridge, selectProject],
  )

  const trustProject = useCallback(
    async (request: WorkspaceTrustRequest): Promise<boolean> => {
      const registration = {
        rootPath: request.candidate.rootPath,
        trusted: true as const,
      }
      const response = request.relinkProjectId
        ? await bridge.relinkProject({ ...registration, projectId: request.relinkProjectId })
        : await bridge.registerProject(registration)
      if (!response.ok) {
        setActionError(response.error.message)
        return false
      }
      void selectProject(response.value.id)
      return true
    },
    [bridge, selectProject],
  )

  const createSession = useCallback(
    async (projectId: string): Promise<void> => {
      setActionError(null)
      const response = await bridge.createSession({ projectId })
      if (!response.ok) {
        setActionError(response.error.message)
        return
      }
      await selectSession(projectId, response.value.id)
    },
    [bridge, selectSession],
  )

  const refreshAfterRemoval = useCallback(async (): Promise<void> => {
    try {
      const value = await refreshSnapshot()
      if (value) await loadSession(value.selectedSessionId)
    } catch (error) {
      setActionError(errorMessage(error))
    }
  }, [loadSession, refreshSnapshot])

  const removeProject = useCallback(
    async (projectId: string): Promise<boolean> => {
      const response = await bridge.removeProject({ projectId })
      if (!response.ok) {
        setActionError(response.error.message)
        return false
      }
      void loadSession(null).then(refreshAfterRemoval)
      return true
    },
    [bridge, loadSession, refreshAfterRemoval],
  )

  const deleteSession = useCallback(
    async (sessionId: string): Promise<boolean> => {
      const response = await bridge.deleteSession({ sessionId })
      if (!response.ok) {
        setActionError(response.error.message)
        return false
      }
      void loadSession(null).then(refreshAfterRemoval)
      return true
    },
    [bridge, loadSession, refreshAfterRemoval],
  )

  const renameSession = useCallback(
    async (sessionId: string, title: string): Promise<boolean> => {
      const response = await bridge.renameSession({ sessionId, title })
      if (!response.ok) {
        setActionError(response.error.message)
        return false
      }
      void Promise.all([
        refreshSnapshot(),
        selectedSessionIdRef.current === response.value.id
          ? loadSession(response.value.id, false)
          : Promise.resolve(),
      ]).catch((error: unknown) => setActionError(errorMessage(error)))
      return true
    },
    [bridge, loadSession, refreshSnapshot],
  )

  const projects = snapshot?.projects ?? []
  const sessions = snapshot?.sessions ?? []
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null
  const activeSessionSummary =
    sessions.find((candidate) => activeStatuses.has(candidate.lastRunStatus ?? '')) ?? null
  const selectedSessionSummary =
    sessions.find((candidate) => candidate.id === selectedSessionId) ?? null
  const activeRun = session?.runs.at(-1) ?? null
  const selectedRunIsActive = Boolean(activeRun && activeStatuses.has(activeRun.status))
  const viewingHistoricalEntry = Boolean(
    sessionTree?.selectedEntryId && sessionTree.selectedEntryId !== sessionTree.activeLeafId,
  )
  const anotherSessionRunning = Boolean(
    activeSessionSummary && activeSessionSummary.id !== selectedSessionId,
  )
  const draft = selectedSessionId ? (drafts[selectedSessionId] ?? '') : ''
  const selectedDraftImages = selectedSessionId ? (draftImages[selectedSessionId] ?? []) : []

  const disabledReason = useMemo(() => {
    if (!selectedProject || !session) return '请先选择一个 Session'
    if (selectedProject.availability !== 'available') return '项目目录不可用'
    if (selectedSessionSummary?.historyAuthority === 'legacy-import') {
      return '旧版会话是只读历史，需要显式导入为 Pi Session'
    }
    if (viewingHistoricalEntry) return '正在查看历史分支；返回当前节点后可以继续发送'
    if (!snapshot?.settings?.hasApiKey) return '模型 API 尚未配置'
    if (selectedRunIsActive) return '当前 Agent 正在运行'
    if (anotherSessionRunning) return '另一个 Session 正在运行'
    return null
  }, [
    anotherSessionRunning,
    selectedProject,
    selectedRunIsActive,
    selectedSessionSummary?.historyAuthority,
    session,
    snapshot?.settings,
    viewingHistoricalEntry,
  ])
  const canInspectSessionTree = Boolean(
    session &&
    session.messages.length > 0 &&
    selectedSessionSummary?.historyAuthority === 'pi-jsonl' &&
    !selectedRunIsActive,
  )

  const setDraft = useCallback(
    (value: string) => {
      const sessionId = selectedSessionIdRef.current
      if (!sessionId) return
      setDrafts((current) => ({ ...current, [sessionId]: value }))
      void bridge.syncComposerText({ sessionId, text: value }).catch(() => undefined)
    },
    [bridge],
  )

  const startRun = useCallback(async (): Promise<void> => {
    const sessionId = selectedSessionIdRef.current
    const prompt = sessionId ? (drafts[sessionId] ?? '').trim() : ''
    const images = sessionId ? (draftImages[sessionId] ?? []) : []
    if (!sessionId || !prompt || disabledReason) return
    setActionError(null)
    setRuntimeUsage(null)
    const response = await bridge.startRun({ sessionId, prompt, images })
    if (!response.ok) {
      setActionError(response.error.message)
      return
    }
    setDrafts((current) => ({ ...current, [sessionId]: '' }))
    setDraftImages((current) => ({ ...current, [sessionId]: [] }))
    await Promise.all([
      loadSession(sessionId, false),
      refreshSnapshot().catch((error: unknown) => setActionError(errorMessage(error))),
    ])
  }, [bridge, disabledReason, draftImages, drafts, loadSession, refreshSnapshot])

  const pickMessageImages = useCallback(async (): Promise<void> => {
    const sessionId = selectedSessionIdRef.current
    if (!sessionId) return
    const response = await bridge.pickMessageImages()
    if (!response.ok) {
      setActionError(response.error.message)
      return
    }
    setDraftImages((current) => ({
      ...current,
      [sessionId]: [...(current[sessionId] ?? []), ...response.value],
    }))
  }, [bridge])

  const removeMessageImage = useCallback((index: number): void => {
    const sessionId = selectedSessionIdRef.current
    if (!sessionId) return
    setDraftImages((current) => ({
      ...current,
      [sessionId]: (current[sessionId] ?? []).filter((_, candidate) => candidate !== index),
    }))
  }, [])

  const stopRun = useCallback(
    async (runId: string): Promise<void> => {
      setActionError(null)
      setSession((current) =>
        current
          ? {
              ...current,
              runs: current.runs.map((run) =>
                run.id === runId ? { ...run, status: 'stopping' as const } : run,
              ),
            }
          : current,
      )
      const response = await bridge.stopRun({ runId })
      if (!response.ok) setActionError(response.error.message)
    },
    [bridge],
  )

  const queueMessage = useCallback(
    async (mode: 'steer' | 'follow-up'): Promise<void> => {
      const sessionId = selectedSessionIdRef.current
      const prompt = sessionId ? (drafts[sessionId] ?? '').trim() : ''
      const runId = session?.runs.at(-1)?.id
      if (!sessionId || !runId || !prompt || !selectedRunIsActive) return
      const response = await bridge.queueRuntimeMessage({ runId, mode, message: prompt })
      if (response.ok) setDrafts((current) => ({ ...current, [sessionId]: '' }))
      else setActionError(response.error.message)
    },
    [bridge, drafts, selectedRunIsActive, session],
  )

  const clearQueue = useCallback(async (): Promise<void> => {
    const runId = session?.runs.at(-1)?.id
    if (!runId || !selectedRunIsActive) return
    const response = await bridge.clearRuntimeQueue({ runId })
    if (!response.ok) setActionError(response.error.message)
  }, [bridge, selectedRunIsActive, session])

  const applySettings = useCallback((settings: ModelSettings) => {
    setSnapshot((current) => (current ? { ...current, settings } : current))
  }, [])

  return {
    snapshot,
    projects,
    sessions,
    selectedProjectId,
    selectedSessionId,
    selectedProject,
    session,
    sessionTree,
    sessionTreeLoading,
    canInspectSessionTree,
    navigatingEntryId,
    forkingEntryId,
    cloningSession,
    importingProjectId,
    exportingSession,
    compactingSession,
    runtimeCompactionReason,
    activeSessionSummary,
    activeRun,
    anotherSessionRunning,
    draft,
    draftImages: selectedDraftImages,
    disabledReason,
    loading,
    sessionLoading,
    loadError,
    actionError,
    queuedMessages,
    runtimeUsage,
    selectProject,
    selectSession,
    pickProject,
    trustProject,
    createSession,
    removeProject,
    deleteSession,
    renameSession,
    inspectSessionHistory,
    navigateSessionTree,
    forkSession,
    cloneSession,
    importSession,
    exportSession,
    compactSession,
    labelSessionEntry,
    cancelSessionOperation,
    startRun,
    pickMessageImages,
    removeMessageImage,
    queueMessage,
    clearQueue,
    stopRun,
    setDraft,
    applySettings,
    reportActionError: setActionError,
  }
}
