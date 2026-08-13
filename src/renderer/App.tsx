import { AlertTriangle, FolderOpen, LoaderCircle, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { Project, SessionSummary } from '../shared/domain'
import type { AppInfo } from '../shared/desktop-bridge'
import { SettingsDialog } from './settings/SettingsDialog'
import { Modal } from './ui/Modal'
import { Conversation } from './workspace/Conversation'
import { Sidebar } from './workspace/Sidebar'
import {
  useWorkspaceController,
  type WorkspaceTrustRequest,
} from './workspace/use-workspace-controller'

type Confirmation =
  | { type: 'remove-project'; project: Project }
  | { type: 'delete-session'; session: SessionSummary }
  | null

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message)
  return '操作失败，请稍后重试'
}

export function App(): React.JSX.Element {
  const workspace = useWorkspaceController(window.pictor)
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [appInfoLoading, setAppInfoLoading] = useState(true)
  const [appInfoError, setAppInfoError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [trustRequest, setTrustRequest] = useState<WorkspaceTrustRequest | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation>(null)
  const [renameTarget, setRenameTarget] = useState<SessionSummary | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [modalBusy, setModalBusy] = useState(false)

  useEffect(() => {
    let active = true
    void window.pictor
      .getAppInfo()
      .then((value) => {
        if (active) setAppInfo(value)
      })
      .catch((error: unknown) => {
        if (active) setAppInfoError(errorMessage(error))
      })
      .finally(() => {
        if (active) setAppInfoLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const pickProject = async (relinkProjectId: string | null = null) => {
    const request = await workspace.pickProject(relinkProjectId)
    if (request) setTrustRequest(request)
  }

  const confirmTrust = async () => {
    if (!trustRequest) return
    setModalBusy(true)
    const completed = await workspace.trustProject(trustRequest)
    setModalBusy(false)
    if (completed) setTrustRequest(null)
  }

  const requestDestructiveAction = (next: Exclude<Confirmation, null>) => {
    const targetSessionId = next.type === 'delete-session' ? next.session.id : null
    const targetProjectId = next.type === 'remove-project' ? next.project.id : null
    if (
      workspace.activeSessionSummary &&
      (workspace.activeSessionSummary.id === targetSessionId ||
        workspace.activeSessionSummary.projectId === targetProjectId)
    ) {
      workspace.reportActionError('请先停止该项目中正在进行的 Agent 运行')
      return
    }
    setConfirmation(next)
  }

  const confirmDestructiveAction = async () => {
    if (!confirmation) return
    setModalBusy(true)
    const completed =
      confirmation.type === 'remove-project'
        ? await workspace.removeProject(confirmation.project.id)
        : await workspace.deleteSession(confirmation.session.id)
    setModalBusy(false)
    if (completed) setConfirmation(null)
  }

  const saveRename = async () => {
    if (!renameTarget || !renameValue.trim()) return
    setModalBusy(true)
    const completed = await workspace.renameSession(renameTarget.id, renameValue.trim())
    setModalBusy(false)
    if (completed) setRenameTarget(null)
  }

  if (workspace.loading || appInfoLoading) {
    return (
      <main className="app-loading">
        <LoaderCircle className="spin" size={22} />
        <span>正在打开 Pictor</span>
      </main>
    )
  }

  const loadError = workspace.loadError ?? appInfoError
  if (loadError || !workspace.snapshot) {
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
        projects={workspace.projects}
        sessions={workspace.sessions}
        selectedProjectId={workspace.selectedProjectId}
        selectedSessionId={workspace.selectedSessionId}
        onAddProject={() => void pickProject()}
        onSelectProject={(id) => void workspace.selectProject(id)}
        onRemoveProject={(project) => requestDestructiveAction({ type: 'remove-project', project })}
        onRelinkProject={(project) => void pickProject(project.id)}
        onCreateSession={(id) => void workspace.createSession(id)}
        onSelectSession={(projectId, sessionId) =>
          void workspace.selectSession(projectId, sessionId)
        }
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
        project={workspace.selectedProject}
        session={workspace.session}
        loading={workspace.sessionLoading}
        draft={workspace.draft}
        appVersion={appInfo?.version ?? null}
        platform={appInfo?.platform ?? null}
        commandInterpreter={appInfo?.commandInterpreter ?? null}
        disabledReason={workspace.disabledReason}
        activeRun={workspace.activeRun}
        anotherSessionRunning={workspace.anotherSessionRunning}
        actionError={workspace.actionError ?? workspace.snapshot.issues[0]?.message ?? null}
        approvalBusyCallId={workspace.approvalBusyCallId}
        onDraftChange={workspace.setDraft}
        onSend={() => void workspace.startRun()}
        onStop={(runId) => void workspace.stopRun(runId)}
        onApprove={(runId, callId) => void workspace.resolveApproval(runId, callId, true)}
        onReject={(runId, callId) => void workspace.resolveApproval(runId, callId, false)}
        onAddProject={() => void pickProject()}
        onCreateSession={(id) => void workspace.createSession(id)}
        onOpenSettings={() => setSettingsOpen(true)}
        onRelinkProject={(project) => void pickProject(project.id)}
      />

      {settingsOpen ? (
        <SettingsDialog
          appInfo={appInfo}
          initial={workspace.snapshot.settings}
          onClose={() => setSettingsOpen(false)}
          onSaved={workspace.applySettings}
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
