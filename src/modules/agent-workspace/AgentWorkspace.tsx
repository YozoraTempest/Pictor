import { AlertTriangle, FolderOpen, LoaderCircle, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { CommandClient } from '../../commands/index.js'
import type { PluginStatus } from '../../plugin/host'
import type { AppInfo } from '../../shared/app-info'
import type { GuiPluginPicker } from '../../shared/desktop-bridge.js'
import type { Project, SessionSummary } from '../../shared/domain'
import { Modal } from '../../renderer/ui/Modal'
import type { SettingsSection } from '../shell/settings'
import { Conversation, type ExtensionWidget } from './Conversation'
import { SettingsDialog } from './SettingsDialog'
import { Sidebar } from './Sidebar'
import type {
  AgentWorkspaceClient,
  AgentWorkspaceFilePicker,
  RuntimeEvent,
  SessionRuntimeControls,
} from './shared'
import { useWorkspaceController, type WorkspaceTrustRequest } from './use-workspace-controller'

type Confirmation =
  | { type: 'remove-project'; project: Project }
  | { type: 'delete-session'; session: SessionSummary }
  | null

type ExtensionUiRequest = Extract<RuntimeEvent, { type: 'extension.ui.requested' }>

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message)
  return '操作失败，请稍后重试'
}

interface AgentWorkspaceProps {
  client: AgentWorkspaceClient
  commandClient: CommandClient
  filePicker: AgentWorkspaceFilePicker
  pluginPicker: GuiPluginPicker
  settingsSections: readonly SettingsSection[]
  rendererPluginStatuses?: readonly PluginStatus[]
}

export function AgentWorkspace({
  client,
  commandClient,
  filePicker,
  pluginPicker,
  settingsSections,
  rendererPluginStatuses = [],
}: AgentWorkspaceProps): React.JSX.Element {
  const workspace = useWorkspaceController(client, filePicker)
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [appInfoLoading, setAppInfoLoading] = useState(true)
  const [appInfoError, setAppInfoError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [trustRequest, setTrustRequest] = useState<WorkspaceTrustRequest | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation>(null)
  const [renameTarget, setRenameTarget] = useState<SessionSummary | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [compactionOpen, setCompactionOpen] = useState(false)
  const [compactionInstructions, setCompactionInstructions] = useState('')
  const [branchSummaryTarget, setBranchSummaryTarget] = useState<string | null>(null)
  const [branchSummaryInstructions, setBranchSummaryInstructions] = useState('')
  const [sessionControls, setSessionControls] = useState<SessionRuntimeControls | null>(null)
  const [entryLabelTarget, setEntryLabelTarget] = useState<string | null>(null)
  const [entryLabelValue, setEntryLabelValue] = useState('')
  const [modalBusy, setModalBusy] = useState(false)
  const [extensionUiRequest, setExtensionUiRequest] = useState<ExtensionUiRequest | null>(null)
  const [extensionUiValue, setExtensionUiValue] = useState('')
  const [extensionNotice, setExtensionNotice] = useState<string | null>(null)
  const [extensionStatuses, setExtensionStatuses] = useState<
    Record<string, Record<string, string>>
  >({})
  const [extensionTitles, setExtensionTitles] = useState<Record<string, string>>({})
  const [extensionWidgets, setExtensionWidgets] = useState<
    Record<string, Record<string, ExtensionWidget>>
  >({})

  useEffect(() => {
    let active = true
    void window.pictor
      .getAppInfo()
      .then((result) => {
        if (!active) return
        if (result.ok) setAppInfo(result.value)
        else setAppInfoError(result.error.message)
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

  useEffect(() => {
    const unsubscribe = client.onRuntimeEvent((event) => {
      if (event.type === 'session.bound') {
        setExtensionWidgets((current) => {
          if (!(event.sessionId in current)) return current
          const next = { ...current }
          delete next[event.sessionId]
          return next
        })
        setExtensionStatuses((current) => {
          if (!(event.sessionId in current)) return current
          const next = { ...current }
          delete next[event.sessionId]
          return next
        })
        setExtensionTitles((current) => {
          if (!(event.sessionId in current)) return current
          const next = { ...current }
          delete next[event.sessionId]
          return next
        })
        setExtensionUiRequest((current) =>
          current?.sessionId === event.sessionId ? null : current,
        )
        setExtensionNotice(null)
      } else if (event.type === 'session.replaced') {
        setExtensionWidgets((current) => {
          if (!(event.sourceSessionId in current)) return current
          const next = { ...current }
          delete next[event.sourceSessionId]
          return next
        })
        setExtensionStatuses((current) => {
          if (!(event.sourceSessionId in current)) return current
          const next = { ...current }
          delete next[event.sourceSessionId]
          return next
        })
        setExtensionTitles((current) => {
          if (!(event.sourceSessionId in current)) return current
          const next = { ...current }
          delete next[event.sourceSessionId]
          return next
        })
        setExtensionUiRequest((current) =>
          current?.sessionId === event.sourceSessionId ? null : current,
        )
        setExtensionNotice(null)
      } else if (event.type === 'extension.ui.widget') {
        setExtensionWidgets((current) => {
          const sessionWidgets = { ...(current[event.sessionId] ?? {}) }
          if (event.lines === null) delete sessionWidgets[event.key]
          else {
            sessionWidgets[event.key] = {
              key: event.key,
              lines: event.lines,
              placement: event.placement,
            }
          }
          return { ...current, [event.sessionId]: sessionWidgets }
        })
      } else if (event.type === 'extension.ui.title') {
        setExtensionTitles((current) => ({ ...current, [event.sessionId]: event.title }))
      } else if (event.type === 'extension.ui.requested') {
        setExtensionUiRequest(event)
        setExtensionUiValue(event.value ?? event.options[0] ?? '')
      } else if (event.type === 'extension.ui.notification') {
        setExtensionNotice(event.message)
      } else if (event.type === 'runtime.diagnostic') {
        setExtensionNotice(event.message)
      } else if (event.type === 'retry.stateChanged' && event.status === 'scheduled') {
        setExtensionNotice(`模型请求重试 ${event.attempt}/${event.maxAttempts ?? '?'}`)
      } else if (event.type === 'extension.ui.status') {
        setExtensionStatuses((current) => {
          const sessionStatuses = { ...(current[event.sessionId] ?? {}) }
          if (event.text === null) delete sessionStatuses[event.key]
          else sessionStatuses[event.key] = event.text
          const next = { ...current }
          if (Object.keys(sessionStatuses).length === 0) delete next[event.sessionId]
          else next[event.sessionId] = sessionStatuses
          return next
        })
      }
    })
    void window.pictor
      .notifyRendererReady()
      .then((result) => {
        if (!result.ok) setExtensionNotice(result.error.message)
      })
      .catch((error: unknown) => setExtensionNotice(errorMessage(error)))
    return unsubscribe
  }, [client])

  useEffect(() => {
    const selectedSessionId = workspace.selectedSessionId
    document.title = selectedSessionId ? extensionTitles[selectedSessionId] || 'Pictor' : 'Pictor'
    return () => {
      document.title = 'Pictor'
    }
  }, [extensionTitles, workspace.selectedSessionId])

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

  const startCompaction = async () => {
    const instructions = compactionInstructions.trim()
    const completed = await workspace.compactSession(instructions || null)
    if (completed) {
      setCompactionOpen(false)
      setCompactionInstructions('')
    }
  }

  const cancelCompaction = async () => {
    const cancelled = await workspace.cancelSessionOperation()
    if (cancelled) setCompactionOpen(false)
  }

  const startBranchSummary = async () => {
    if (!branchSummaryTarget) return
    const instructions = branchSummaryInstructions.trim()
    const completed = await workspace.navigateSessionTree(branchSummaryTarget, {
      summarize: true,
      customInstructions: instructions || null,
    })
    if (completed) {
      setBranchSummaryTarget(null)
      setBranchSummaryInstructions('')
    }
  }

  const cancelBranchSummary = async () => {
    const cancelled = await workspace.cancelSessionOperation()
    if (cancelled) setBranchSummaryTarget(null)
  }

  const openSessionControls = async () => {
    if (!workspace.selectedSessionId) return
    const response = await client.getSessionRuntimeControls({
      sessionId: workspace.selectedSessionId,
    })
    if (response.ok) setSessionControls(response.value)
    else workspace.reportActionError(response.error.message)
  }

  const saveSessionControls = async () => {
    if (!workspace.selectedSessionId || !sessionControls) return
    setModalBusy(true)
    const response = await client.saveSessionRuntimeControls({
      sessionId: workspace.selectedSessionId,
      controls: {
        modelId: sessionControls.modelId,
        thinkingLevel: sessionControls.thinkingLevel,
        activeTools: sessionControls.activeTools,
        steeringMode: sessionControls.steeringMode,
        followUpMode: sessionControls.followUpMode,
      },
    })
    setModalBusy(false)
    if (response.ok) setSessionControls(null)
    else workspace.reportActionError(response.error.message)
  }

  const reloadSessionResources = async () => {
    if (!workspace.selectedSessionId) return
    setModalBusy(true)
    const response = await client.reloadSessionResources({
      sessionId: workspace.selectedSessionId,
    })
    setModalBusy(false)
    if (response.ok) {
      setSessionControls(null)
      setExtensionNotice('Runtime 资源已重载')
    } else workspace.reportActionError(response.error.message)
  }

  const saveEntryLabel = async () => {
    if (!entryLabelTarget) return
    setModalBusy(true)
    const completed = await workspace.labelSessionEntry(
      entryLabelTarget,
      entryLabelValue.trim() || null,
    )
    setModalBusy(false)
    if (completed) setEntryLabelTarget(null)
  }

  const respondToExtensionUi = async (value: string | boolean | null) => {
    if (!extensionUiRequest) return
    setModalBusy(true)
    const response = await client.respondToExtensionUi({
      sessionId: extensionUiRequest.sessionId,
      requestId: extensionUiRequest.requestId,
      value,
    })
    setModalBusy(false)
    if (response.ok) setExtensionUiRequest(null)
    else workspace.reportActionError(response.error.message)
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

  const currentExtensionStatuses = workspace.selectedSessionId
    ? (extensionStatuses[workspace.selectedSessionId] ?? {})
    : {}
  const currentExtensionStatusEntries = Object.entries(currentExtensionStatuses).sort(
    ([firstKey], [secondKey]) => firstKey.localeCompare(secondKey),
  )
  const currentExtensionUiRequest =
    extensionUiRequest?.sessionId === workspace.selectedSessionId ? extensionUiRequest : null

  return (
    <main className="app-shell">
      <Sidebar
        projects={workspace.projects}
        sessions={workspace.sessions}
        selectedProjectId={workspace.selectedProjectId}
        selectedSessionId={workspace.selectedSessionId}
        importingProjectId={workspace.importingProjectId}
        exportingSession={workspace.exportingSession}
        onAddProject={() => void pickProject()}
        onSelectProject={(id) => void workspace.selectProject(id)}
        onRemoveProject={(project) => requestDestructiveAction({ type: 'remove-project', project })}
        onRelinkProject={(project) => void pickProject(project.id)}
        onCreateSession={(id) => void workspace.createSession(id)}
        onImportSession={(id) => void workspace.importSession(id)}
        onExportSession={(id, format) => void workspace.exportSession(id, format)}
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
        key={workspace.selectedSessionId ?? workspace.selectedProjectId ?? 'empty-workspace'}
        project={workspace.selectedProject}
        session={workspace.session}
        loading={workspace.sessionLoading}
        draft={workspace.draft}
        draftImages={workspace.draftImages}
        extensionWidgets={
          workspace.selectedSessionId
            ? Object.values(extensionWidgets[workspace.selectedSessionId] ?? {})
            : []
        }
        appVersion={appInfo?.version ?? null}
        disabledReason={workspace.disabledReason}
        activeRun={workspace.activeRun}
        anotherSessionRunning={workspace.anotherSessionRunning}
        actionError={workspace.actionError ?? workspace.snapshot.issues[0]?.message ?? null}
        queuedMessages={workspace.queuedMessages}
        runtimeUsage={workspace.runtimeUsage}
        sessionTree={workspace.sessionTree}
        sessionTreeLoading={workspace.sessionTreeLoading}
        canInspectSessionTree={workspace.canInspectSessionTree}
        navigatingEntryId={workspace.navigatingEntryId}
        forkingEntryId={workspace.forkingEntryId}
        cloningSession={workspace.cloningSession}
        compactingSession={workspace.compactingSession}
        runtimeCompactionReason={workspace.runtimeCompactionReason}
        onDraftChange={workspace.setDraft}
        onPickMessageImages={() => void workspace.pickMessageImages()}
        onRemoveMessageImage={workspace.removeMessageImage}
        onSend={() => void workspace.startRun()}
        onQueue={(mode) => void workspace.queueMessage(mode)}
        onClearQueue={() => void workspace.clearQueue()}
        onInspectSessionHistory={(entryId) => void workspace.inspectSessionHistory(entryId)}
        onNavigateSessionTree={(entryId) => void workspace.navigateSessionTree(entryId)}
        onOpenBranchSummary={(entryId) => setBranchSummaryTarget(entryId)}
        onOpenEntryLabel={(entryId, label) => {
          setEntryLabelTarget(entryId)
          setEntryLabelValue(label)
        }}
        onOpenCompaction={() => setCompactionOpen(true)}
        onCancelSessionOperation={() => void workspace.cancelSessionOperation()}
        onOpenSessionControls={() => void openSessionControls()}
        onForkSession={(entryId) => void workspace.forkSession(entryId)}
        onCloneSession={() => void workspace.cloneSession()}
        onStop={(runId) => void workspace.stopRun(runId)}
        onAddProject={() => void pickProject()}
        onCreateSession={(id) => void workspace.createSession(id)}
        onOpenSettings={() => setSettingsOpen(true)}
        onRelinkProject={(project) => void pickProject(project.id)}
      />

      {extensionNotice || currentExtensionStatusEntries.length > 0 ? (
        <div className="extension-notices">
          {extensionNotice ? (
            <button
              className="extension-notice"
              type="button"
              onClick={() => setExtensionNotice(null)}
            >
              {extensionNotice}
            </button>
          ) : null}

          {currentExtensionStatusEntries.length > 0 ? (
            <div className="extension-statuses" aria-label="Extension statuses" aria-live="polite">
              {currentExtensionStatusEntries.map(([key, text]) => (
                <div className="extension-status" data-status-key={key} key={key}>
                  {text}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {settingsOpen ? (
        <SettingsDialog
          client={client}
          commandClient={commandClient}
          initial={workspace.snapshot.settings}
          pluginPicker={pluginPicker}
          sections={settingsSections}
          rendererPluginStatuses={rendererPluginStatuses}
          onClose={() => setSettingsOpen(false)}
          onSaved={workspace.applySettings}
        />
      ) : null}

      {currentExtensionUiRequest ? (
        <Modal
          title={currentExtensionUiRequest.title}
          description={currentExtensionUiRequest.message ?? ''}
          onClose={() =>
            void respondToExtensionUi(currentExtensionUiRequest.kind === 'confirm' ? false : null)
          }
        >
          <div className="extension-ui-dialog">
            {currentExtensionUiRequest.kind === 'select' ? (
              <label className="field field--full">
                <span>选择</span>
                <select
                  aria-label={currentExtensionUiRequest.title}
                  value={extensionUiValue}
                  onChange={(event) => setExtensionUiValue(event.target.value)}
                >
                  {currentExtensionUiRequest.options.map((option) => (
                    <option value={option} key={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            ) : currentExtensionUiRequest.kind === 'input' ? (
              <label className="field field--full">
                <span>输入</span>
                <input
                  autoFocus
                  value={extensionUiValue}
                  placeholder={currentExtensionUiRequest.value ?? ''}
                  onChange={(event) => setExtensionUiValue(event.target.value)}
                />
              </label>
            ) : currentExtensionUiRequest.kind === 'editor' ? (
              <label className="field field--full">
                <span>内容</span>
                <textarea
                  autoFocus
                  value={extensionUiValue}
                  onChange={(event) => setExtensionUiValue(event.target.value)}
                />
              </label>
            ) : (
              <p>{currentExtensionUiRequest.message}</p>
            )}
          </div>
          <footer className="modal-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={modalBusy}
              onClick={() =>
                void respondToExtensionUi(
                  currentExtensionUiRequest.kind === 'confirm' ? false : null,
                )
              }
            >
              取消
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={modalBusy}
              onClick={() =>
                void respondToExtensionUi(
                  currentExtensionUiRequest.kind === 'confirm' ? true : extensionUiValue,
                )
              }
            >
              {modalBusy ? <LoaderCircle className="spin" size={15} /> : null}
              确认
            </button>
          </footer>
        </Modal>
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
            <p>
              Pi 原生工具和项目 Extension 会以当前用户权限运行；请只信任你了解的项目和代码来源。
            </p>
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

      {compactionOpen ? (
        <Modal
          title="压缩上下文"
          onClose={() => {
            if (!workspace.compactingSession) setCompactionOpen(false)
          }}
        >
          <label className="field field--full">
            <span>自定义摘要指令（可选）</span>
            <textarea
              rows={6}
              maxLength={20_000}
              value={compactionInstructions}
              disabled={workspace.compactingSession}
              onChange={(event) => setCompactionInstructions(event.target.value)}
            />
          </label>
          <footer className="modal-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() =>
                workspace.compactingSession ? void cancelCompaction() : setCompactionOpen(false)
              }
            >
              {workspace.compactingSession ? '取消压缩' : '取消'}
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={workspace.compactingSession}
              onClick={() => void startCompaction()}
            >
              {workspace.compactingSession ? <LoaderCircle className="spin" size={15} /> : null}
              开始压缩
            </button>
          </footer>
        </Modal>
      ) : null}

      {branchSummaryTarget ? (
        <Modal
          title="总结后切换分支"
          onClose={() => {
            if (!workspace.navigatingEntryId) setBranchSummaryTarget(null)
          }}
        >
          <label className="field field--full">
            <span>自定义摘要指令（可选）</span>
            <textarea
              rows={6}
              maxLength={20_000}
              value={branchSummaryInstructions}
              disabled={workspace.navigatingEntryId !== null}
              onChange={(event) => setBranchSummaryInstructions(event.target.value)}
            />
          </label>
          <footer className="modal-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() =>
                workspace.navigatingEntryId
                  ? void cancelBranchSummary()
                  : setBranchSummaryTarget(null)
              }
            >
              {workspace.navigatingEntryId ? '取消总结' : '取消'}
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={workspace.navigatingEntryId !== null}
              onClick={() => void startBranchSummary()}
            >
              {workspace.navigatingEntryId ? <LoaderCircle className="spin" size={15} /> : null}
              总结并切换
            </button>
          </footer>
        </Modal>
      ) : null}

      {sessionControls ? (
        <Modal title="Session Controls" onClose={() => setSessionControls(null)}>
          <div className="form-grid">
            <label className="field field--full">
              <span>Model</span>
              <input
                value={sessionControls.modelId}
                onChange={(event) =>
                  setSessionControls((current) =>
                    current ? { ...current, modelId: event.target.value } : current,
                  )
                }
              />
            </label>
            <label className="field field--full">
              <span>Thinking Level</span>
              <select
                value={sessionControls.thinkingLevel}
                onChange={(event) =>
                  setSessionControls((current) =>
                    current
                      ? {
                          ...current,
                          thinkingLevel: event.target
                            .value as SessionRuntimeControls['thinkingLevel'],
                        }
                      : current,
                  )
                }
              >
                {['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map((level) => (
                  <option value={level} key={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Steering</span>
              <select
                value={sessionControls.steeringMode}
                onChange={(event) =>
                  setSessionControls((current) =>
                    current
                      ? {
                          ...current,
                          steeringMode: event.target.value as 'all' | 'one-at-a-time',
                        }
                      : current,
                  )
                }
              >
                <option value="one-at-a-time">one-at-a-time</option>
                <option value="all">all</option>
              </select>
            </label>
            <label className="field">
              <span>Follow-up</span>
              <select
                value={sessionControls.followUpMode}
                onChange={(event) =>
                  setSessionControls((current) =>
                    current
                      ? {
                          ...current,
                          followUpMode: event.target.value as 'all' | 'one-at-a-time',
                        }
                      : current,
                  )
                }
              >
                <option value="one-at-a-time">one-at-a-time</option>
                <option value="all">all</option>
              </select>
            </label>
          </div>
          <fieldset className="field field--full">
            <legend>Active Tools</legend>
            <div className="tool-toggle-list">
              {sessionControls.availableTools.map((tool) => (
                <label key={tool}>
                  <input
                    type="checkbox"
                    checked={sessionControls.activeTools.includes(tool)}
                    onChange={(event) =>
                      setSessionControls((current) =>
                        current
                          ? {
                              ...current,
                              activeTools: event.target.checked
                                ? [...current.activeTools, tool]
                                : current.activeTools.filter((name) => name !== tool),
                            }
                          : current,
                      )
                    }
                  />
                  <span>{tool}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <footer className="modal-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={modalBusy}
              onClick={() => void reloadSessionResources()}
            >
              重新加载资源
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={modalBusy}
              onClick={() => setSessionControls(null)}
            >
              取消
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={modalBusy}
              onClick={() => void saveSessionControls()}
            >
              保存
            </button>
          </footer>
        </Modal>
      ) : null}

      {entryLabelTarget ? (
        <Modal title="标记 Session 节点" onClose={() => setEntryLabelTarget(null)}>
          <label className="field field--full">
            <span>Label</span>
            <input
              autoFocus
              maxLength={120}
              value={entryLabelValue}
              onChange={(event) => setEntryLabelValue(event.target.value)}
            />
          </label>
          <footer className="modal-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={modalBusy}
              onClick={() => setEntryLabelTarget(null)}
            >
              取消
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={modalBusy}
              onClick={() => void saveEntryLabel()}
            >
              保存
            </button>
          </footer>
        </Modal>
      ) : null}
    </main>
  )
}
