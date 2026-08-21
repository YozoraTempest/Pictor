import {
  AlertTriangle,
  ChevronRight,
  FileJson,
  FileText,
  FileUp,
  Folder,
  FolderPlus,
  MessageSquareText,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings,
  Trash2,
} from 'lucide-react'

import type { SessionExportFormat } from '../../shared/desktop-bridge'
import type { Project, SessionSummary } from '../../shared/domain'

interface SidebarProps {
  projects: Project[]
  sessions: SessionSummary[]
  selectedProjectId: string | null
  selectedSessionId: string | null
  importingProjectId: string | null
  exportingSession: { sessionId: string; format: SessionExportFormat } | null
  onAddProject: () => void
  onSelectProject: (projectId: string) => void
  onRemoveProject: (project: Project) => void
  onRelinkProject: (project: Project) => void
  onCreateSession: (projectId: string) => void
  onImportSession: (projectId: string) => void
  onExportSession: (sessionId: string, format: SessionExportFormat) => void
  onSelectSession: (projectId: string, sessionId: string) => void
  onRenameSession: (session: SessionSummary) => void
  onDeleteSession: (session: SessionSummary) => void
  onOpenSettings: () => void
}

const activeStatuses = new Set(['queued', 'running', 'awaiting-approval', 'stopping'])

function formatUpdatedAt(value: string): string {
  const updated = new Date(value)
  const today = new Date()
  if (updated.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(updated)
  }
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(updated)
}

function SessionStatus({ status }: { status: SessionSummary['lastRunStatus'] }): React.JSX.Element {
  const label = status === 'awaiting-approval' ? '等待批准' : status === 'running' ? '运行中' : ''
  return (
    <span
      className={`session-status ${status ? `session-status--${status}` : ''}`}
      aria-label={label || undefined}
      title={label || undefined}
    />
  )
}

export function Sidebar({
  projects,
  sessions,
  selectedProjectId,
  selectedSessionId,
  importingProjectId,
  exportingSession,
  onAddProject,
  onSelectProject,
  onRemoveProject,
  onRelinkProject,
  onCreateSession,
  onImportSession,
  onExportSession,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  onOpenSettings,
}: SidebarProps): React.JSX.Element {
  return (
    <aside className="sidebar" aria-label="项目与会话">
      <div className="brand-row">
        <div className="brand-mark" aria-hidden="true">
          P
        </div>
        <div className="brand-copy">
          <strong>Pictor</strong>
          <span>委托工作区</span>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="新建项目"
          title="新建项目"
          onClick={onAddProject}
        >
          <FolderPlus size={17} />
        </button>
      </div>

      <div className="navigation-scroll">
        <div className="navigation-label">
          <span>项目</span>
          <button
            className="mini-icon-button"
            type="button"
            aria-label="新建项目"
            title="新建项目"
            onClick={onAddProject}
          >
            <Plus size={14} />
          </button>
        </div>
        {projects.length === 0 ? (
          <div className="sidebar-empty">
            <Folder size={20} />
            <span>尚未添加项目</span>
          </div>
        ) : (
          <div className="project-list">
            {projects.map((project) => {
              const selected = project.id === selectedProjectId
              const projectSessions = sessions
                .filter((session) => session.projectId === project.id)
                .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
              return (
                <section className="project-group" key={project.id} aria-label={project.name}>
                  <div className={`project-row ${selected ? 'is-selected' : ''}`}>
                    <button
                      className="project-select"
                      type="button"
                      onClick={() => onSelectProject(project.id)}
                    >
                      <ChevronRight className={selected ? 'is-open' : ''} size={14} />
                      {project.availability === 'available' ? (
                        <Folder size={15} />
                      ) : (
                        <AlertTriangle size={15} />
                      )}
                      <span title={project.rootPath}>{project.name}</span>
                    </button>
                    <details className="item-menu">
                      <summary aria-label={`${project.name} 项目操作`} title="项目操作">
                        <MoreHorizontal size={15} />
                      </summary>
                      <div className="menu-popover">
                        {project.availability === 'available' ? (
                          <button
                            type="button"
                            disabled={importingProjectId !== null}
                            onClick={() => onImportSession(project.id)}
                          >
                            {importingProjectId === project.id ? (
                              <LoaderCircle className="spin" size={14} />
                            ) : (
                              <FileUp size={14} />
                            )}
                            导入 Pi Session
                          </button>
                        ) : null}
                        {project.availability !== 'available' ? (
                          <button type="button" onClick={() => onRelinkProject(project)}>
                            <Folder size={14} />
                            重新关联
                          </button>
                        ) : null}
                        <button
                          className="danger-menu-item"
                          type="button"
                          onClick={() => onRemoveProject(project)}
                        >
                          <Trash2 size={14} />
                          移除项目
                        </button>
                      </div>
                    </details>
                  </div>

                  {selected ? (
                    <div className="session-list">
                      <button
                        className="new-session-button"
                        type="button"
                        disabled={project.availability !== 'available'}
                        onClick={() => onCreateSession(project.id)}
                      >
                        <Plus size={14} />
                        新建 Session
                      </button>
                      {projectSessions.map((session) => (
                        <div
                          className={`session-row ${session.id === selectedSessionId ? 'is-selected' : ''}`}
                          key={session.id}
                        >
                          <button
                            className="session-select"
                            type="button"
                            onClick={() => onSelectSession(project.id, session.id)}
                          >
                            {activeStatuses.has(session.lastRunStatus ?? '') ? (
                              <SessionStatus status={session.lastRunStatus} />
                            ) : (
                              <MessageSquareText size={14} />
                            )}
                            <span className="session-title">{session.title}</span>
                            <time dateTime={session.updatedAt}>
                              {formatUpdatedAt(session.updatedAt)}
                            </time>
                          </button>
                          <details className="item-menu item-menu--session">
                            <summary aria-label={`${session.title} 会话操作`} title="会话操作">
                              <MoreHorizontal size={14} />
                            </summary>
                            <div className="menu-popover">
                              <button
                                type="button"
                                disabled={exportingSession !== null}
                                onClick={() => onExportSession(session.id, 'jsonl')}
                              >
                                {exportingSession?.sessionId === session.id &&
                                exportingSession.format === 'jsonl' ? (
                                  <LoaderCircle className="spin" size={14} />
                                ) : (
                                  <FileJson size={14} />
                                )}
                                导出 JSONL
                              </button>
                              <button
                                type="button"
                                disabled={exportingSession !== null}
                                onClick={() => onExportSession(session.id, 'html')}
                              >
                                {exportingSession?.sessionId === session.id &&
                                exportingSession.format === 'html' ? (
                                  <LoaderCircle className="spin" size={14} />
                                ) : (
                                  <FileText size={14} />
                                )}
                                导出 HTML
                              </button>
                              <button type="button" onClick={() => onRenameSession(session)}>
                                <Pencil size={14} />
                                重命名
                              </button>
                              <button
                                className="danger-menu-item"
                                type="button"
                                onClick={() => onDeleteSession(session)}
                              >
                                <Trash2 size={14} />
                                删除 Session
                              </button>
                            </div>
                          </details>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </section>
              )
            })}
          </div>
        )}
      </div>

      <button className="settings-button" type="button" onClick={onOpenSettings}>
        <Settings size={16} />
        <span>设置</span>
      </button>
    </aside>
  )
}
