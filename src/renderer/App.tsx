import { AlertTriangle, FolderOpen, LoaderCircle, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type {
  AppInfo,
  AppSnapshot,
  IpcError,
  Project,
  ProjectCandidate,
  SessionRecord,
  SessionSummary,
} from '../shared/contracts'
import { Conversation } from './components/Conversation'
import { Modal } from './components/Modal'
import { SettingsDialog } from './components/SettingsDialog'
import { Sidebar } from './components/Sidebar'

const activeStatuses = new Set(['queued', 'running', 'awaiting-approval', 'stopping'])

type Confirmation =
  | { type: 'remove-project'; project: Project }
  | { type: 'delete-session'; session: SessionSummary }
  | null

interface TrustRequest {
  candidate: ProjectCandidate
  relinkProjectId: string | null
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message)
  return '操作失败，请稍后重试'
}

export function App(): React.JSX.Element {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [session, setSession] = useState<SessionRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [sessionLoading, setSessionLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [trustRequest, setTrustRequest] = useState<TrustRequest | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation>(null)
  const [renameTarget, setRenameTarget] = useState<SessionSummary | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [modalBusy, setModalBusy] = useState(false)
  const [approvalBusyCallId, setApprovalBusyCallId] = useState<string | null>(null)
  const sessionRequestId = useRef(0)

  const applySnapshot = useCallback((value: AppSnapshot) => {
    setSnapshot(value)
    setSelectedProjectId(value.selectedProjectId)
    setSelectedSessionId(value.selectedSessionId)
  }, [])

  const refreshSnapshot = useCallback(async () => {
    const response = await window.pictor.getSnapshot()
    if (!response.ok) throw response.error
    applySnapshot(response.value)
    return response.value
  }, [applySnapshot])

  const loadSession = useCallback(async (sessionId: string | null, showLoading = true) => {
    const requestId = ++sessionRequestId.current
    if (!sessionId) {
      setSession(null)
      setSessionLoading(false)
      return
    }
    if (showLoading) setSessionLoading(true)
    const response = await window.pictor.getSession({ sessionId })
    if (requestId !== sessionRequestId.current) return
    if (response.ok) {
      setSession(response.value)
      setActionError(null)
    } else {
      setSession(null)
      setActionError(response.error.message)
    }
    setSessionLoading(false)
  }, [])

  useEffect(() => {
    let active = true
    void Promise.all([window.pictor.getAppInfo(), window.pictor.getSnapshot()])
      .then(([info, response]) => {
        if (!active) return
        setAppInfo(info)
        if (!response.ok) throw response.error
        applySnapshot(response.value)
        return loadSession(response.value.selectedSessionId)
      })
      .catch((error: unknown) => {
        if (active) setLoadError(errorMessage(error))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [applySnapshot, loadSession])

  useEffect(() => {
    return window.pictor.onRuntimeEvent((event) => {
      if (event.sessionId === selectedSessionId && event.type === 'message.delta') {
        setSession((current) =>
          current
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
      } else if (event.sessionId === selectedSessionId && event.type === 'tool.updated') {
        setSession((current) =>
          current
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
      } else {
        if (event.sessionId === selectedSessionId) {
          void loadSession(event.sessionId, false).catch((error: unknown) =>
            setActionError(errorMessage(error)),
          )
        }
      }
      if (event.type !== 'message.delta' && event.type !== 'tool.updated') {
        void refreshSnapshot().catch((error: unknown) => setActionError(errorMessage(error)))
      }
    })
  }, [loadSession, refreshSnapshot, selectedSessionId])

  const projects = snapshot?.projects ?? []
  const sessions = snapshot?.sessions ?? []
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null
  const activeSessionSummary = sessions.find((candidate) =>
    activeStatuses.has(candidate.lastRunStatus ?? ''),
  )
  const lastRun = session?.runs.at(-1) ?? null
  const selectedRunIsActive = Boolean(lastRun && activeStatuses.has(lastRun.status))
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

  const selectProject = async (projectId: string) => {
    setActionError(null)
    const response = await window.pictor.selectContext({ projectId, sessionId: null })
    if (!response.ok) return setActionError(response.error.message)
    setSelectedProjectId(projectId)
    setSelectedSessionId(null)
    setSession(null)
    await refreshSnapshot().catch((error: unknown) => setActionError(errorMessage(error)))
  }

  const selectSession = async (projectId: string, sessionId: string) => {
    setActionError(null)
    setSelectedProjectId(projectId)
    setSelectedSessionId(sessionId)
    setSessionLoading(true)
    const response = await window.pictor.selectContext({ projectId, sessionId })
    if (!response.ok) {
      setSessionLoading(false)
      return setActionError(response.error.message)
    }
    await Promise.all([
      loadSession(sessionId),
      refreshSnapshot().catch((error: unknown) => setActionError(errorMessage(error))),
    ])
  }

  const pickProject = async (relinkProjectId: string | null = null) => {
    setActionError(null)
    const response = await window.pictor.pickProjectDirectory()
    if (!response.ok) return setActionError(response.error.message)
    if (!response.value) return
    if (response.value.existingProjectId) {
      if (relinkProjectId && response.value.existingProjectId !== relinkProjectId) {
        return setActionError('该目录已属于另一个项目，请选择不同目录')
      }
      await selectProject(response.value.existingProjectId)
      return
    }
    setTrustRequest({ candidate: response.value, relinkProjectId })
  }

  const confirmTrust = async () => {
    if (!trustRequest) return
    setModalBusy(true)
    const request = {
      rootPath: trustRequest.candidate.rootPath,
      trusted: true as const,
    }
    const response = trustRequest.relinkProjectId
      ? await window.pictor.relinkProject({ ...request, projectId: trustRequest.relinkProjectId })
      : await window.pictor.registerProject(request)
    setModalBusy(false)
    if (!response.ok) return setActionError(response.error.message)
    setTrustRequest(null)
    await selectProject(response.value.id)
  }

  const createSession = async (projectId: string) => {
    setActionError(null)
    const response = await window.pictor.createSession({ projectId })
    if (!response.ok) return setActionError(response.error.message)
    await selectSession(projectId, response.value.id)
  }

  const startRun = async () => {
    if (!selectedSessionId || !draft.trim() || disabledReason) return
    setActionError(null)
    const prompt = draft.trim()
    const response = await window.pictor.startRun({ sessionId: selectedSessionId, prompt })
    if (!response.ok) return setActionError(response.error.message)
    setDrafts((current) => ({ ...current, [selectedSessionId]: '' }))
    await Promise.all([
      loadSession(selectedSessionId, false),
      refreshSnapshot().catch((error: unknown) => setActionError(errorMessage(error))),
    ])
  }

  const stopRun = async (runId: string) => {
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
    const response = await window.pictor.stopRun({ runId })
    if (!response.ok) setActionError(response.error.message)
  }

  const resolveApproval = async (runId: string, callId: string, allowed: boolean) => {
    setApprovalBusyCallId(callId)
    setActionError(null)
    const response = allowed
      ? await window.pictor.approveCommand({ runId, callId })
      : await window.pictor.rejectCommand({ runId, callId })
    setApprovalBusyCallId(null)
    if (!response.ok) setActionError(response.error.message)
  }

  const confirmDestructiveAction = async () => {
    if (!confirmation) return
    setModalBusy(true)
    let response: { ok: boolean; error?: IpcError }
    if (confirmation.type === 'remove-project') {
      response = await window.pictor.removeProject({ projectId: confirmation.project.id })
    } else {
      response = await window.pictor.deleteSession({ sessionId: confirmation.session.id })
    }
    setModalBusy(false)
    if (!response.ok) return setActionError(response.error?.message ?? '删除失败')
    setConfirmation(null)
    setSession(null)
    await refreshSnapshot()
      .then((value) => loadSession(value.selectedSessionId))
      .catch((error: unknown) => setActionError(errorMessage(error)))
  }

  const requestDestructiveAction = (next: Exclude<Confirmation, null>) => {
    const targetSessionId = next.type === 'delete-session' ? next.session.id : null
    const targetProjectId = next.type === 'remove-project' ? next.project.id : null
    if (
      activeSessionSummary &&
      (activeSessionSummary.id === targetSessionId ||
        activeSessionSummary.projectId === targetProjectId)
    ) {
      setActionError('请先停止该项目中正在进行的 Agent 运行')
      return
    }
    setConfirmation(next)
  }

  const saveRename = async () => {
    if (!renameTarget || !renameValue.trim()) return
    setModalBusy(true)
    const response = await window.pictor.renameSession({
      sessionId: renameTarget.id,
      title: renameValue.trim(),
    })
    setModalBusy(false)
    if (!response.ok) return setActionError(response.error.message)
    setRenameTarget(null)
    await Promise.all([
      refreshSnapshot(),
      selectedSessionId === response.value.id
        ? loadSession(response.value.id, false)
        : Promise.resolve(),
    ])
  }

  if (loading) {
    return (
      <main className="app-loading">
        <LoaderCircle className="spin" size={22} />
        <span>正在打开 Pictor</span>
      </main>
    )
  }

  if (loadError || !snapshot) {
    return (
      <main className="fatal-state">
        <AlertTriangle size={26} />
        <h1>无法加载本地工作区</h1>
        <p>{loadError ?? 'Pictor 未能读取应用状态。'}</p>
        <button className="secondary-button" type="button" onClick={() => location.reload()}>
          重新加载
        </button>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <Sidebar
        projects={projects}
        sessions={sessions}
        selectedProjectId={selectedProjectId}
        selectedSessionId={selectedSessionId}
        onAddProject={() => void pickProject()}
        onSelectProject={(id) => void selectProject(id)}
        onRemoveProject={(project) => requestDestructiveAction({ type: 'remove-project', project })}
        onRelinkProject={(project) => void pickProject(project.id)}
        onCreateSession={(id) => void createSession(id)}
        onSelectSession={(projectId, sessionId) => void selectSession(projectId, sessionId)}
        onRenameSession={(target) => {
          setRenameTarget(target)
          setRenameValue(target.title)
        }}
        onDeleteSession={(target) =>
          requestDestructiveAction({ type: 'delete-session', session: target })
        }
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <Conversation
        project={selectedProject}
        session={session}
        loading={sessionLoading}
        draft={draft}
        appVersion={appInfo?.version ?? null}
        disabledReason={disabledReason}
        activeRun={lastRun}
        anotherSessionRunning={anotherSessionRunning}
        actionError={actionError ?? snapshot.issues[0]?.message ?? null}
        approvalBusyCallId={approvalBusyCallId}
        onDraftChange={(value) =>
          selectedSessionId && setDrafts((current) => ({ ...current, [selectedSessionId]: value }))
        }
        onSend={() => void startRun()}
        onStop={(runId) => void stopRun(runId)}
        onApprove={(runId, callId) => void resolveApproval(runId, callId, true)}
        onReject={(runId, callId) => void resolveApproval(runId, callId, false)}
        onAddProject={() => void pickProject()}
        onCreateSession={(id) => void createSession(id)}
        onOpenSettings={() => setSettingsOpen(true)}
        onRelinkProject={(project) => void pickProject(project.id)}
      />

      {settingsOpen ? (
        <SettingsDialog
          appInfo={appInfo}
          initial={snapshot.settings}
          onClose={() => setSettingsOpen(false)}
          onSaved={(settings) =>
            setSnapshot((current) => (current ? { ...current, settings } : current))
          }
        />
      ) : null}

      {trustRequest ? (
        <Modal
          title={trustRequest.relinkProjectId ? '重新关联项目' : '信任此项目？'}
          description={trustRequest.candidate.rootPath}
          onClose={() => setTrustRequest(null)}
        >
          <div className="trust-content">
            <ShieldCheck size={22} />
            <p>
              Agent 可以读取和修改此目录中的文件，并会把完成任务所需的上下文发送到你配置的模型 API。
            </p>
            <p>任何命令仍会逐条显示完整内容，得到你的批准后才会执行。</p>
          </div>
          <footer className="modal-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => setTrustRequest(null)}
              disabled={modalBusy}
            >
              取消
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={() => void confirmTrust()}
              disabled={modalBusy}
            >
              {modalBusy ? <LoaderCircle className="spin" size={15} /> : <FolderOpen size={15} />}
              信任并添加
            </button>
          </footer>
        </Modal>
      ) : null}

      {confirmation ? (
        <Modal
          title={confirmation.type === 'remove-project' ? '移除项目？' : '删除 Session？'}
          description={
            confirmation.type === 'remove-project'
              ? confirmation.project.name
              : confirmation.session.title
          }
          onClose={() => setConfirmation(null)}
        >
          <div className="confirm-content">
            <AlertTriangle size={21} />
            <p>
              {confirmation.type === 'remove-project'
                ? 'Pictor 将删除此项目的登记和全部 Session 数据，但不会删除本地项目目录或其中的文件。'
                : '此 Session 的消息、运行和工具记录将从 Pictor 中永久删除。项目文件不会改变。'}
            </p>
          </div>
          <footer className="modal-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => setConfirmation(null)}
              disabled={modalBusy}
            >
              取消
            </button>
            <button
              className="danger-button"
              type="button"
              onClick={() => void confirmDestructiveAction()}
              disabled={modalBusy}
            >
              {modalBusy ? <LoaderCircle className="spin" size={15} /> : null}
              {confirmation.type === 'remove-project' ? '移除项目' : '删除 Session'}
            </button>
          </footer>
        </Modal>
      ) : null}

      {renameTarget ? (
        <Modal title="重命名 Session" onClose={() => setRenameTarget(null)}>
          <label className="field field--full rename-field">
            <span>名称</span>
            <input
              value={renameValue}
              maxLength={120}
              autoFocus
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void saveRename()
              }}
            />
          </label>
          <footer className="modal-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => setRenameTarget(null)}
              disabled={modalBusy}
            >
              取消
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={() => void saveRename()}
              disabled={modalBusy || !renameValue.trim()}
            >
              保存
            </button>
          </footer>
        </Modal>
      ) : null}
    </main>
  )
}
