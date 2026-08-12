import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { Project, RunRecord, SessionRecord, SessionSummary } from '../../shared/domain'
import type { AppSnapshot, PictorBridge, ProjectCandidate } from '../../shared/desktop-bridge'
import type { ModelSettings } from '../../shared/model'

const activeStatuses = new Set(['queued', 'running', 'awaiting-approval', 'stopping'])

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
  | 'startRun'
  | 'approveCommand'
  | 'rejectCommand'
  | 'stopRun'
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
  activeSessionSummary: SessionSummary | null
  activeRun: RunRecord | null
  anotherSessionRunning: boolean
  draft: string
  disabledReason: string | null
  loading: boolean
  sessionLoading: boolean
  loadError: string | null
  actionError: string | null
  approvalBusyCallId: string | null
  selectProject: (projectId: string) => Promise<void>
  selectSession: (projectId: string, sessionId: string) => Promise<void>
  pickProject: (relinkProjectId?: string | null) => Promise<WorkspaceTrustRequest | null>
  trustProject: (request: WorkspaceTrustRequest) => Promise<boolean>
  createSession: (projectId: string) => Promise<void>
  removeProject: (projectId: string) => Promise<boolean>
  deleteSession: (sessionId: string) => Promise<boolean>
  renameSession: (sessionId: string, title: string) => Promise<boolean>
  startRun: () => Promise<void>
  stopRun: (runId: string) => Promise<void>
  resolveApproval: (runId: string, callId: string, allowed: boolean) => Promise<void>
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
  const [loading, setLoading] = useState(true)
  const [sessionLoading, setSessionLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [approvalBusyCallId, setApprovalBusyCallId] = useState<string | null>(null)
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
        setSessionLoading(false)
        return
      }
      if (showLoading) setSessionLoading(true)
      const response = await bridge.getSession({ sessionId })
      if (requestId !== sessionRequestId.current) return
      if (response.ok) {
        setSession(response.value)
        setActionError(null)
      } else {
        setSession(null)
        setActionError(response.error.message)
      }
      setSessionLoading(false)
    },
    [bridge],
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
      if (event.sessionId === currentSessionId && event.type === 'message.delta') {
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
      } else if (event.sessionId === currentSessionId) {
        void loadSession(event.sessionId, false).catch((error: unknown) =>
          setActionError(errorMessage(error)),
        )
      }

      if (event.type !== 'message.delta' && event.type !== 'tool.updated') {
        void refreshSnapshot().catch((error: unknown) => setActionError(errorMessage(error)))
      }
    })
  }, [bridge, loadSession, loading, refreshSnapshot])

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
  const activeRun = session?.runs.at(-1) ?? null
  const selectedRunIsActive = Boolean(activeRun && activeStatuses.has(activeRun.status))
  const anotherSessionRunning = Boolean(
    activeSessionSummary && activeSessionSummary.id !== selectedSessionId,
  )
  const draft = selectedSessionId ? (drafts[selectedSessionId] ?? '') : ''

  const disabledReason = useMemo(() => {
    if (!selectedProject || !session) return '请先选择一个 Session'
    if (selectedProject.availability !== 'available') return '项目目录不可用'
    if (!snapshot?.settings?.hasApiKey) return '模型 API 尚未配置'
    if (selectedRunIsActive) return '当前 Agent 正在运行'
    if (anotherSessionRunning) return '另一个 Session 正在运行'
    return null
  }, [anotherSessionRunning, selectedProject, selectedRunIsActive, session, snapshot?.settings])

  const setDraft = useCallback((value: string) => {
    const sessionId = selectedSessionIdRef.current
    if (sessionId) setDrafts((current) => ({ ...current, [sessionId]: value }))
  }, [])

  const startRun = useCallback(async (): Promise<void> => {
    const sessionId = selectedSessionIdRef.current
    const prompt = sessionId ? (drafts[sessionId] ?? '').trim() : ''
    if (!sessionId || !prompt || disabledReason) return
    setActionError(null)
    const response = await bridge.startRun({ sessionId, prompt })
    if (!response.ok) {
      setActionError(response.error.message)
      return
    }
    setDrafts((current) => ({ ...current, [sessionId]: '' }))
    await Promise.all([
      loadSession(sessionId, false),
      refreshSnapshot().catch((error: unknown) => setActionError(errorMessage(error))),
    ])
  }, [bridge, disabledReason, drafts, loadSession, refreshSnapshot])

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

  const resolveApproval = useCallback(
    async (runId: string, callId: string, allowed: boolean): Promise<void> => {
      setApprovalBusyCallId(callId)
      setActionError(null)
      try {
        const response = allowed
          ? await bridge.approveCommand({ runId, callId })
          : await bridge.rejectCommand({ runId, callId })
        if (!response.ok) setActionError(response.error.message)
      } catch (error) {
        setActionError(errorMessage(error))
      } finally {
        setApprovalBusyCallId(null)
      }
    },
    [bridge],
  )

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
    activeSessionSummary,
    activeRun,
    anotherSessionRunning,
    draft,
    disabledReason,
    loading,
    sessionLoading,
    loadError,
    actionError,
    approvalBusyCallId,
    selectProject,
    selectSession,
    pickProject,
    trustProject,
    createSession,
    removeProject,
    deleteSession,
    renameSession,
    startRun,
    stopRun,
    resolveApproval,
    setDraft,
    applySettings,
    reportActionError: setActionError,
  }
}
