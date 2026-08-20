import {
  AlertCircle,
  AlertTriangle,
  Bot,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock3,
  Combine,
  Copy,
  Cpu,
  FilePenLine,
  FileSearch,
  FolderSearch2,
  GitBranch,
  GitFork,
  ImagePlus,
  LoaderCircle,
  LocateFixed,
  MessageSquareText,
  Play,
  Plus,
  Route,
  Send,
  ShieldAlert,
  SlidersHorizontal,
  Square,
  Tag,
  TerminalSquare,
  Wrench,
  X,
  XCircle,
} from 'lucide-react'
import { isValidElement, useEffect, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import type {
  Project,
  ImageAttachment,
  RunRecord,
  SessionRecord,
  SessionTreeNode,
  SessionTreeView,
  ToolEvent,
  UsageSnapshot,
} from '../../shared/domain'
import type { AppInfo } from '../../shared/app-info'

type RuntimeUsage = UsageSnapshot

interface ConversationProps {
  project: Project | null
  session: SessionRecord | null
  loading: boolean
  draft: string
  draftImages: ImageAttachment[]
  appVersion: string | null
  platform: AppInfo['platform'] | null
  commandInterpreter: AppInfo['commandInterpreter'] | null
  disabledReason: string | null
  activeRun: RunRecord | null
  anotherSessionRunning: boolean
  actionError: string | null
  approvalBusyCallId: string | null
  queuedMessages: { steering: number; followUp: number }
  runtimeUsage: RuntimeUsage | null
  sessionTree: SessionTreeView | null
  sessionTreeLoading: boolean
  canInspectSessionTree: boolean
  forkingEntryId: string | null
  cloningSession: boolean
  navigatingEntryId: string | null
  compactingSession: boolean
  runtimeCompactionReason: 'manual' | 'threshold' | 'overflow' | null
  onDraftChange: (value: string) => void
  onPickMessageImages: () => void
  onRemoveMessageImage: (index: number) => void
  onSend: () => void
  onQueue: (mode: 'steer' | 'follow-up') => void
  onClearQueue: () => void
  onInspectSessionHistory: (entryId: string | null) => void
  onNavigateSessionTree: (entryId: string) => void
  onOpenBranchSummary: (entryId: string) => void
  onOpenEntryLabel: (entryId: string, label: string) => void
  onOpenCompaction: () => void
  onCancelSessionOperation: () => void
  onOpenSessionControls: () => void
  onForkSession: (entryId: string) => void
  onCloneSession: () => void
  onStop: (runId: string) => void
  onApprove: (runId: string, callId: string) => void
  onReject: (runId: string, callId: string) => void
  onAddProject: () => void
  onCreateSession: (projectId: string) => void
  onOpenSettings: () => void
  onRelinkProject: (project: Project) => void
}

const statusLabels: Record<RunRecord['status'], string> = {
  queued: '等待开始',
  running: '运行中',
  'awaiting-approval': '等待批准',
  stopping: '正在停止',
  completed: '已完成',
  failed: '失败',
  stopped: '已停止',
  interrupted: '已中断',
}

const toolLabels: Record<ToolEvent['kind'], string> = {
  list: '列出文件',
  search: '搜索项目',
  read: '读取文件',
  write: '写入文件',
  edit: '编辑文件',
  move: '移动文件',
  delete: '删除文件',
  command: '执行命令',
  custom: 'Extension Tool',
}

function ToolIcon({ kind }: { kind: ToolEvent['kind'] }): React.JSX.Element {
  if (kind === 'command') return <TerminalSquare size={15} />
  if (kind === 'custom') return <Wrench size={15} />
  if (kind === 'edit' || kind === 'write' || kind === 'move' || kind === 'delete') {
    return <FilePenLine size={15} />
  }
  if (kind === 'read') return <FileSearch size={15} />
  return <FolderSearch2 size={15} />
}

function nodeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children)
  return ''
}

function MarkdownMessage({ content }: { content: string }): React.JSX.Element {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        pre: ({ children }) => {
          const code = nodeText(children).replace(/\n$/, '')
          return (
            <div className="code-block">
              <button
                className="copy-code-button"
                type="button"
                aria-label="复制代码"
                title="复制代码"
                onClick={() => void navigator.clipboard.writeText(code)}
              >
                <Copy size={14} />
              </button>
              <pre>{children}</pre>
            </div>
          )
        },
      }}
    >
      {content}
    </ReactMarkdown>
  )
}

function StatusBadge({ status }: { status: RunRecord['status'] }): React.JSX.Element {
  const icon =
    status === 'completed' ? (
      <CheckCircle2 size={13} />
    ) : status === 'failed' || status === 'interrupted' ? (
      <AlertCircle size={13} />
    ) : status === 'stopped' ? (
      <XCircle size={13} />
    ) : status === 'awaiting-approval' ? (
      <ShieldAlert size={13} />
    ) : (
      <LoaderCircle
        className={status === 'running' || status === 'stopping' ? 'spin' : ''}
        size={13}
      />
    )
  return (
    <span className={`status-badge status-badge--${status}`}>
      {icon}
      {statusLabels[status]}
    </span>
  )
}

function CommandInterpreterNotice({
  commandInterpreter,
}: Pick<ConversationProps, 'commandInterpreter'>): React.JSX.Element | null {
  if (!commandInterpreter || commandInterpreter.available) return null
  return (
    <div className="workspace-notice workspace-notice--info" role="status">
      <TerminalSquare size={15} />
      <span>{commandInterpreter.message}</span>
    </div>
  )
}

function ToolActivity({
  run,
  tool,
  busy,
  platform,
  outputOpen,
  onOutputOpenChange,
  onApprove,
  onReject,
}: {
  run: RunRecord
  tool: ToolEvent
  busy: boolean
  platform: AppInfo['platform'] | null
  outputOpen: boolean
  onOutputOpenChange: (callId: string, open: boolean) => void
  onApprove: (runId: string, callId: string) => void
  onReject: (runId: string, callId: string) => void
}): React.JSX.Element {
  const pendingApproval = tool.command?.approval === 'pending'
  return (
    <article className={`tool-activity ${pendingApproval ? 'tool-activity--approval' : ''}`}>
      <div className="tool-heading">
        <span className="tool-icon">
          <ToolIcon kind={tool.kind} />
        </span>
        <div className="tool-summary">
          <strong>{toolLabels[tool.kind]}</strong>
          <span>{tool.path ?? tool.label}</span>
        </div>
        <span className={`tool-state tool-state--${tool.status}`}>
          {tool.status === 'completed' ? (
            <Check size={13} />
          ) : tool.status === 'rejected' || tool.status === 'failed' ? (
            <X size={13} />
          ) : (
            <Circle size={10} />
          )}
          {tool.status === 'running'
            ? '进行中'
            : tool.status === 'completed'
              ? '完成'
              : tool.status === 'rejected'
                ? '已拒绝'
                : tool.status === 'failed'
                  ? '失败'
                  : '等待'}
        </span>
      </div>

      {tool.command ? (
        <div className="command-detail">
          <p>{tool.command.purpose}</p>
          <code>{tool.command.command}</code>
          <span>工作目录：{tool.command.cwd}</span>
          {pendingApproval ? (
            <div className="approval-actions">
              <div className="approval-warning">
                <ShieldAlert size={14} />
                {`此命令将以当前 ${platform === 'linux' ? 'Linux' : 'Windows'} 用户权限运行`}
              </div>
              <button
                className="secondary-button"
                type="button"
                disabled={busy}
                onClick={() => onReject(run.id, tool.callId)}
              >
                <X size={14} />
                拒绝
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={busy}
                onClick={() => onApprove(run.id, tool.callId)}
              >
                {busy ? <LoaderCircle className="spin" size={14} /> : <Play size={14} />}
                允许一次
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {tool.output ? (
        <details className="tool-output" open={outputOpen}>
          <summary
            onClick={(event) => {
              event.preventDefault()
              onOutputOpenChange(tool.callId, !outputOpen)
            }}
          >
            <ChevronDown size={14} />
            查看输出
          </summary>
          <pre>{tool.output}</pre>
        </details>
      ) : null}
    </article>
  )
}

function Timeline({
  session,
  approvalBusyCallId,
  platform,
  onApprove,
  onReject,
}: Pick<
  ConversationProps,
  'session' | 'approvalBusyCallId' | 'platform' | 'onApprove' | 'onReject'
>): React.JSX.Element {
  const bottomRef = useRef<HTMLDivElement>(null)
  const [expandedToolCalls, setExpandedToolCalls] = useState<Set<string>>(() => new Set())
  const contentKey = session?.messages.map((message) => message.content.length).join(':') ?? ''

  const updateToolOutput = (callId: string, open: boolean): void => {
    setExpandedToolCalls((current) => {
      if (current.has(callId) === open) return current
      const next = new Set(current)
      if (open) next.add(callId)
      else next.delete(callId)
      return next
    })
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ block: 'end' })
  }, [contentKey, session?.runs.length])

  if (!session || session.messages.length === 0) {
    return (
      <div className="conversation-empty">
        <MessageSquareText size={24} />
        <h2>把任务交给 Pictor</h2>
        <p>描述目标和约束，Agent 会读取当前项目并展示每一步工具操作。</p>
      </div>
    )
  }

  let assistantIndex = 0
  return (
    <div className="timeline-inner">
      {session.messages.map((message) => {
        const run = message.role === 'assistant' ? session.runs[assistantIndex++] : null
        return (
          <div className={`turn turn--${message.role}`} key={message.id}>
            <div className="turn-label">{message.role === 'user' ? '你' : 'Pictor'}</div>
            {run?.toolEvents.map((tool) => (
              <ToolActivity
                key={tool.callId}
                run={run}
                tool={tool}
                busy={approvalBusyCallId === tool.callId}
                platform={platform}
                outputOpen={tool.status === 'failed' || expandedToolCalls.has(tool.callId)}
                onOutputOpenChange={updateToolOutput}
                onApprove={onApprove}
                onReject={onReject}
              />
            ))}
            {message.content ? (
              <div className="message-content">
                <MarkdownMessage content={message.content} />
              </div>
            ) : message.status === 'streaming' ? (
              <div className="agent-thinking">
                <LoaderCircle className="spin" size={14} />
                正在处理
              </div>
            ) : null}
            {message.images && message.images.length > 0 ? (
              <div className="message-images">
                {message.images.map((image, index) => (
                  <img
                    src={`data:${image.mimeType};base64,${image.data}`}
                    alt={image.name ?? `图片 ${index + 1}`}
                    key={`${message.id}-image-${index}`}
                  />
                ))}
              </div>
            ) : null}
            {run ? (
              <div className="run-footer">
                <StatusBadge status={run.status} />
                {run.error ? <span className="run-error">{run.error}</span> : null}
              </div>
            ) : null}
          </div>
        )
      })}
      <div ref={bottomRef} />
    </div>
  )
}

function TreeNodeIcon({ kind }: { kind: SessionTreeNode['kind'] }): React.JSX.Element {
  if (kind === 'user') return <MessageSquareText size={14} />
  if (kind === 'assistant') return <Bot size={14} />
  if (kind === 'tool-result') return <Wrench size={14} />
  if (kind === 'compaction' || kind === 'branch-summary') return <Combine size={14} />
  if (kind === 'model') return <Cpu size={14} />
  if (kind === 'thinking') return <Brain size={14} />
  if (kind === 'custom' || kind === 'custom-message') return <Wrench size={14} />
  return <Circle size={10} />
}

function SessionTreePanel({
  tree,
  loading,
  forkingEntryId,
  cloningSession,
  navigatingEntryId,
  onSelect,
  onNavigate,
  onOpenBranchSummary,
  onOpenEntryLabel,
  onFork,
  onClone,
  onClose,
}: {
  tree: SessionTreeView | null
  loading: boolean
  forkingEntryId: string | null
  cloningSession: boolean
  navigatingEntryId: string | null
  onSelect: (entryId: string | null) => void
  onNavigate: (entryId: string) => void
  onOpenBranchSummary: (entryId: string) => void
  onOpenEntryLabel: (entryId: string, label: string) => void
  onFork: (entryId: string) => void
  onClone: () => void
  onClose: () => void
}): React.JSX.Element {
  const selectedEntryId = tree?.selectedEntryId ?? null
  const selectedNode = tree?.nodes.find((node) => node.id === selectedEntryId)
  const canFork = Boolean(selectedEntryId && selectedEntryId !== tree?.activeLeafId)
  const canClone = Boolean(tree?.activeLeafId && selectedEntryId === tree.activeLeafId)
  const canNavigate = Boolean(selectedNode && selectedEntryId !== tree?.activeLeafId)
  const operationBusy = forkingEntryId !== null || cloningSession || navigatingEntryId !== null
  return (
    <aside className="session-tree-panel" aria-label="Session Tree">
      <div className="session-tree-header">
        <div>
          <GitBranch size={15} />
          <strong>Session Tree</strong>
          {tree ? <span>{tree.nodes.length}</span> : null}
        </div>
        <div className="session-tree-actions">
          <button
            className="mini-icon-button"
            type="button"
            aria-label="切换到此节点"
            title="切换到此节点"
            disabled={!canNavigate || operationBusy}
            onClick={() => {
              if (selectedEntryId) onNavigate(selectedEntryId)
            }}
          >
            {navigatingEntryId ? <LoaderCircle className="spin" size={14} /> : <Route size={14} />}
          </button>
          <button
            className="mini-icon-button"
            type="button"
            aria-label="标记节点"
            title="标记节点"
            disabled={!selectedNode || operationBusy}
            onClick={() => {
              if (selectedNode) onOpenEntryLabel(selectedNode.id, selectedNode.label)
            }}
          >
            <Tag size={14} />
          </button>
          <button
            className="mini-icon-button"
            type="button"
            aria-label="总结后切换到此节点"
            title="总结后切换到此节点"
            disabled={!canNavigate || operationBusy}
            onClick={() => {
              if (selectedEntryId) onOpenBranchSummary(selectedEntryId)
            }}
          >
            <Combine size={14} />
          </button>
          <button
            className="mini-icon-button"
            type="button"
            aria-label="Fork 为新 Session"
            title="Fork 为新 Session"
            disabled={!canFork || operationBusy}
            onClick={() => {
              if (selectedEntryId) onFork(selectedEntryId)
            }}
          >
            {forkingEntryId ? <LoaderCircle className="spin" size={14} /> : <GitFork size={14} />}
          </button>
          <button
            className="mini-icon-button"
            type="button"
            aria-label="Clone 当前分支为新 Session"
            title="Clone 当前分支为新 Session"
            disabled={!canClone || operationBusy}
            onClick={onClone}
          >
            {cloningSession ? <LoaderCircle className="spin" size={14} /> : <Copy size={14} />}
          </button>
          <button
            className="mini-icon-button"
            type="button"
            aria-label="返回当前节点"
            title="返回当前节点"
            disabled={!tree?.activeLeafId || tree.selectedEntryId === tree.activeLeafId}
            onClick={() => onSelect(null)}
          >
            <LocateFixed size={14} />
          </button>
          <button
            className="mini-icon-button"
            type="button"
            aria-label="关闭 Session Tree"
            title="关闭 Session Tree"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="session-tree-list">
        {loading ? (
          <div className="session-tree-state">
            <LoaderCircle className="spin" size={16} />
            加载 Session Tree
          </div>
        ) : tree && tree.nodes.length > 0 ? (
          tree.nodes.map((node) => (
            <button
              className={`session-tree-node${node.isSelected ? ' is-selected' : ''}${
                node.isActivePath ? ' is-active-path' : ''
              }`}
              style={{ '--tree-depth': Math.min(node.depth, 8) } as React.CSSProperties}
              type="button"
              key={node.id}
              aria-current={node.isSelected ? 'true' : undefined}
              title={node.label}
              onClick={() => onSelect(node.id)}
            >
              <span className="session-tree-node__icon">
                <TreeNodeIcon kind={node.kind} />
              </span>
              <span className="session-tree-node__label">{node.label}</span>
              {node.childCount > 1 ? (
                <span className="session-tree-node__branches">{node.childCount}</span>
              ) : null}
              {node.isActiveLeaf ? (
                <LocateFixed className="session-tree-node__leaf" size={12} />
              ) : null}
            </button>
          ))
        ) : (
          <div className="session-tree-state">暂无树记录</div>
        )}
      </div>
    </aside>
  )
}

export function Conversation(props: ConversationProps): React.JSX.Element {
  const {
    project,
    session,
    loading,
    draft,
    draftImages,
    appVersion,
    platform,
    commandInterpreter,
    disabledReason,
    activeRun,
    anotherSessionRunning,
    actionError,
    approvalBusyCallId,
    queuedMessages,
    runtimeUsage,
    sessionTree,
    sessionTreeLoading,
    canInspectSessionTree,
    forkingEntryId,
    cloningSession,
    navigatingEntryId,
    compactingSession,
    runtimeCompactionReason,
    onDraftChange,
    onPickMessageImages,
    onRemoveMessageImage,
    onSend,
    onQueue,
    onClearQueue,
    onInspectSessionHistory,
    onNavigateSessionTree,
    onOpenBranchSummary,
    onOpenEntryLabel,
    onOpenCompaction,
    onCancelSessionOperation,
    onOpenSessionControls,
    onForkSession,
    onCloneSession,
    onStop,
    onApprove,
    onReject,
    onAddProject,
    onCreateSession,
    onOpenSettings,
    onRelinkProject,
  } = props
  const [queueMode, setQueueMode] = useState<'steer' | 'follow-up'>('steer')
  const [treeOpen, setTreeOpen] = useState(false)
  const runActive = Boolean(
    activeRun && ['queued', 'running', 'awaiting-approval', 'stopping'].includes(activeRun.status),
  )
  const viewingHistoricalEntry = Boolean(
    sessionTree?.selectedEntryId && sessionTree.selectedEntryId !== sessionTree.activeLeafId,
  )
  const send = (): void => {
    if (!runActive) setTreeOpen(false)
    onSend()
  }

  if (!project) {
    return (
      <section className="workspace" aria-label="会话">
        <header className="workspace-header">
          <div>
            <span className="eyebrow">委托模式</span>
            <h1>选择一个项目开始</h1>
          </div>
          <span className="version-label">{appVersion ? `v${appVersion}` : '正在连接'}</span>
        </header>
        <CommandInterpreterNotice commandInterpreter={commandInterpreter} />
        <div className="empty-state">
          <div className="empty-icon">
            <MessageSquareText size={24} />
          </div>
          <h2>从本地项目创建第一个 Session</h2>
          <p>项目、会话和 Agent 运行会在这里保持连续。</p>
          <button className="primary-button" type="button" onClick={onAddProject}>
            <FolderSearch2 size={16} />
            新建项目
          </button>
        </div>
      </section>
    )
  }

  if (!session) {
    return (
      <section className="workspace" aria-label="会话">
        <header className="workspace-header">
          <div>
            <span className="eyebrow">{project.rootPath}</span>
            <h1>{project.name}</h1>
          </div>
          <span className="version-label">{appVersion ? `v${appVersion}` : ''}</span>
        </header>
        <CommandInterpreterNotice commandInterpreter={commandInterpreter} />
        <div className="empty-state">
          <div className="empty-icon">
            {project.availability === 'available' ? (
              <MessageSquareText size={24} />
            ) : (
              <AlertCircle size={24} />
            )}
          </div>
          <h2>
            {project.availability === 'available' ? '新建 Session 开始委托' : '项目目录不可用'}
          </h2>
          <p>
            {project.availability === 'available'
              ? '每个 Session 都会保留消息、工具操作和运行结果。'
              : '目录可能已移动、删除或失去访问权限。'}
          </p>
          <button
            className="primary-button"
            type="button"
            onClick={() =>
              project.availability === 'available'
                ? onCreateSession(project.id)
                : onRelinkProject(project)
            }
          >
            {project.availability === 'available' ? <PlusIcon /> : <FolderSearch2 size={16} />}
            {project.availability === 'available' ? '新建 Session' : '重新关联目录'}
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="workspace workspace--conversation" aria-label="会话">
      <header className="workspace-header">
        <div className="session-heading">
          <span className="eyebrow">{project.name} · 委托模式</span>
          <h1>{session.title}</h1>
        </div>
        <div className="header-actions">
          <button
            className="icon-button"
            type="button"
            aria-label="Session Controls"
            title="Session Controls"
            disabled={!canInspectSessionTree || compactingSession}
            onClick={onOpenSessionControls}
          >
            <SlidersHorizontal size={16} />
          </button>
          {compactingSession ? (
            <button
              className="icon-button"
              type="button"
              aria-label="取消上下文压缩"
              title="取消上下文压缩"
              onClick={onCancelSessionOperation}
            >
              <Square size={15} />
            </button>
          ) : (
            <button
              className="icon-button"
              type="button"
              aria-label="压缩上下文"
              title="压缩上下文"
              disabled={!canInspectSessionTree || runtimeCompactionReason !== null}
              onClick={onOpenCompaction}
            >
              {runtimeCompactionReason ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Combine size={16} />
              )}
            </button>
          )}
          {canInspectSessionTree ? (
            <button
              className="icon-button session-tree-toggle"
              type="button"
              aria-label="Session Tree"
              title="Session Tree"
              aria-pressed={treeOpen}
              onClick={() => {
                const nextOpen = !treeOpen
                setTreeOpen(nextOpen)
                if (nextOpen && !sessionTree) onInspectSessionHistory(null)
              }}
            >
              <GitBranch size={16} />
            </button>
          ) : null}
          {runtimeUsage ? (
            <span className="usage-summary">
              {runtimeUsage.tokens.total.toLocaleString()} tokens
              {runtimeUsage.context?.percent === null || runtimeUsage.context === null
                ? ''
                : ` · ${Math.round(runtimeUsage.context.percent)}% context`}
            </span>
          ) : null}
          {session.runtimeState?.modelId ? (
            <span className="usage-summary" title={session.runtimeState.modelId}>
              {session.runtimeState.modelId}
              {session.runtimeState.thinkingLevel ? ` · ${session.runtimeState.thinkingLevel}` : ''}
            </span>
          ) : null}
          {activeRun ? <StatusBadge status={activeRun.status} /> : null}
          {activeRun &&
          ['queued', 'running', 'awaiting-approval', 'stopping'].includes(activeRun.status) ? (
            <button
              className="stop-button"
              type="button"
              disabled={activeRun.status === 'stopping'}
              onClick={() => onStop(activeRun.id)}
            >
              <Square size={12} fill="currentColor" />
              {activeRun.status === 'stopping' ? '正在停止' : '停止'}
            </button>
          ) : null}
        </div>
      </header>

      {project.availability !== 'available' ? (
        <div className="workspace-notice">
          <AlertTriangle size={15} />
          <span>项目目录不可用，历史记录仍可查看。</span>
          <button type="button" onClick={() => onRelinkProject(project)}>
            重新关联
          </button>
        </div>
      ) : null}
      <CommandInterpreterNotice commandInterpreter={commandInterpreter} />
      {anotherSessionRunning ? (
        <div className="workspace-notice workspace-notice--info">
          <Clock3 size={15} />
          <span>另一个 Session 正在运行；当前对话暂时不能发送。</span>
        </div>
      ) : null}
      {actionError ? (
        <div className="workspace-error" role="alert">
          <AlertCircle size={15} />
          {actionError}
        </div>
      ) : null}

      <div className="conversation-main">
        {treeOpen ? (
          <SessionTreePanel
            tree={sessionTree}
            loading={sessionTreeLoading}
            forkingEntryId={forkingEntryId}
            cloningSession={cloningSession}
            navigatingEntryId={navigatingEntryId}
            onSelect={onInspectSessionHistory}
            onNavigate={onNavigateSessionTree}
            onOpenBranchSummary={onOpenBranchSummary}
            onOpenEntryLabel={onOpenEntryLabel}
            onFork={onForkSession}
            onClone={onCloneSession}
            onClose={() => setTreeOpen(false)}
          />
        ) : null}
        <div className="timeline" aria-live="polite">
          {loading ? (
            <div className="loading-state">
              <LoaderCircle className="spin" size={18} />
              加载 Session
            </div>
          ) : (
            <Timeline
              key={session.id}
              session={session}
              approvalBusyCallId={approvalBusyCallId}
              platform={platform}
              onApprove={onApprove}
              onReject={onReject}
            />
          )}
        </div>
      </div>

      <div className="composer-wrap">
        {draftImages.length > 0 ? (
          <div className="composer-images">
            {draftImages.map((image, index) => (
              <div className="composer-image" key={`${image.name ?? 'image'}-${index}`}>
                <img
                  src={`data:${image.mimeType};base64,${image.data}`}
                  alt={image.name ?? `图片 ${index + 1}`}
                />
                <button
                  className="mini-icon-button"
                  type="button"
                  aria-label={`移除 ${image.name ?? `图片 ${index + 1}`}`}
                  onClick={() => onRemoveMessageImage(index)}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {disabledReason && !runActive ? (
          <div className="composer-reason">
            {disabledReason}
            {disabledReason.includes('模型') ? (
              <button type="button" onClick={onOpenSettings}>
                打开设置
              </button>
            ) : null}
          </div>
        ) : null}
        {runActive ? (
          <div className="queue-controls">
            <div className="protocol-switch" role="group" aria-label="队列模式">
              <button
                type="button"
                className={queueMode === 'steer' ? 'is-active' : ''}
                aria-pressed={queueMode === 'steer'}
                onClick={() => setQueueMode('steer')}
              >
                引导 ({queuedMessages.steering})
              </button>
              <button
                type="button"
                className={queueMode === 'follow-up' ? 'is-active' : ''}
                aria-pressed={queueMode === 'follow-up'}
                onClick={() => setQueueMode('follow-up')}
              >
                跟进 ({queuedMessages.followUp})
              </button>
            </div>
            {queuedMessages.steering + queuedMessages.followUp > 0 ? (
              <button className="secondary-button" type="button" onClick={onClearQueue}>
                清空队列
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="composer">
          <button
            className="icon-button"
            type="button"
            aria-label="添加图片"
            title="添加图片"
            disabled={loading || viewingHistoricalEntry || runActive}
            onClick={onPickMessageImages}
          >
            <ImagePlus size={17} />
          </button>
          <textarea
            value={draft}
            rows={3}
            placeholder="描述要在当前项目中完成的任务…"
            aria-label="任务描述"
            disabled={loading || viewingHistoricalEntry}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault()
                send()
              }
            }}
          />
          <button
            className="send-button"
            type="button"
            aria-label="发送任务"
            title={runActive ? '加入队列' : '发送任务'}
            disabled={(!runActive && Boolean(disabledReason)) || !draft.trim() || loading}
            onClick={() => (runActive ? onQueue(queueMode) : send())}
          >
            <Send size={17} />
          </button>
        </div>
      </div>
    </section>
  )
}

function PlusIcon(): React.JSX.Element {
  return <Plus size={16} />
}
