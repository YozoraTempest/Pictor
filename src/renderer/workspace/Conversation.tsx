import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock3,
  Copy,
  FilePenLine,
  FileSearch,
  FolderSearch2,
  LoaderCircle,
  MessageSquareText,
  Play,
  Plus,
  Send,
  ShieldAlert,
  Square,
  TerminalSquare,
  Wrench,
  X,
  XCircle,
} from 'lucide-react'
import { isValidElement, useEffect, useRef, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import type { Project, RunRecord, SessionRecord, ToolEvent } from '../../shared/domain'
import type { AppInfo } from '../../shared/app-info'

interface ConversationProps {
  project: Project | null
  session: SessionRecord | null
  loading: boolean
  draft: string
  appVersion: string | null
  platform: AppInfo['platform'] | null
  commandInterpreter: AppInfo['commandInterpreter'] | null
  disabledReason: string | null
  activeRun: RunRecord | null
  anotherSessionRunning: boolean
  actionError: string | null
  approvalBusyCallId: string | null
  onDraftChange: (value: string) => void
  onSend: () => void
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
  onApprove,
  onReject,
}: {
  run: RunRecord
  tool: ToolEvent
  busy: boolean
  platform: AppInfo['platform'] | null
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
        <details className="tool-output" open={tool.status === 'failed'}>
          <summary>
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
  const contentKey = session?.messages.map((message) => message.content.length).join(':') ?? ''

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
                key={tool.id}
                run={run}
                tool={tool}
                busy={approvalBusyCallId === tool.callId}
                platform={platform}
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

export function Conversation(props: ConversationProps): React.JSX.Element {
  const {
    project,
    session,
    loading,
    draft,
    appVersion,
    platform,
    commandInterpreter,
    disabledReason,
    activeRun,
    anotherSessionRunning,
    actionError,
    approvalBusyCallId,
    onDraftChange,
    onSend,
    onStop,
    onApprove,
    onReject,
    onAddProject,
    onCreateSession,
    onOpenSettings,
    onRelinkProject,
  } = props

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

      <div className="timeline" aria-live="polite">
        {loading ? (
          <div className="loading-state">
            <LoaderCircle className="spin" size={18} />
            加载 Session
          </div>
        ) : (
          <Timeline
            session={session}
            approvalBusyCallId={approvalBusyCallId}
            platform={platform}
            onApprove={onApprove}
            onReject={onReject}
          />
        )}
      </div>

      <div className="composer-wrap">
        {disabledReason ? (
          <div className="composer-reason">
            {disabledReason}
            {disabledReason.includes('模型') ? (
              <button type="button" onClick={onOpenSettings}>
                打开设置
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="composer">
          <textarea
            value={draft}
            rows={3}
            placeholder="描述要在当前项目中完成的任务…"
            aria-label="任务描述"
            disabled={loading}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault()
                onSend()
              }
            }}
          />
          <button
            className="send-button"
            type="button"
            aria-label="发送任务"
            title="发送任务"
            disabled={Boolean(disabledReason) || !draft.trim() || loading}
            onClick={onSend}
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
