import {
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Pin,
  PinOff,
  SquarePen,
  Trash2,
  X,
} from 'lucide-react'
import { useMemo, useState } from 'react'

import type { Session } from '@pictor/shared'

import { useWorkspaceStore } from '../../app/workspace-store.js'
import { Button, IconButton, Input } from '../../components/ui/index.js'
import { cn } from '../../lib/cn.js'
import { ProjectsPanel } from '../projects/ProjectsPanel.js'
import { groupSessions } from './grouping.js'

export function SessionsPanel(): React.JSX.Element {
  const sessions = useWorkspaceStore((state) => state.sessions)
  const projects = useWorkspaceStore((state) => state.projects)
  const sections = useWorkspaceStore((state) => state.sections)
  const selectedProjectId = useWorkspaceStore((state) => state.selectedProjectId)
  const selectedSessionId = useWorkspaceStore((state) => state.selectedSessionId)
  const grouping = useWorkspaceStore((state) => state.grouping)
  const exclusive = useWorkspaceStore((state) => state.groupingExclusive)
  const busy = useWorkspaceStore((state) => state.busy)

  const selectSession = useWorkspaceStore((state) => state.selectSession)
  const createSession = useWorkspaceStore((state) => state.createSession)
  const deleteSession = useWorkspaceStore((state) => state.deleteSession)
  const setSessionPinned = useWorkspaceStore((state) => state.setSessionPinned)
  const setSessionProject = useWorkspaceStore((state) => state.setSessionProject)
  const setSessionSections = useWorkspaceStore((state) => state.setSessionSections)

  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [menuId, setMenuId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const groups = useMemo(
    () => groupSessions({ sessions, projects, sections, grouping, exclusive }),
    [sessions, projects, sections, grouping, exclusive],
  )

  function submit(): void {
    const trimmed = title.trim()
    if (trimmed.length === 0) return
    void createSession(trimmed, selectedProjectId)
    setTitle('')
    setCreating(false)
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="px-2 pt-2 pb-1">
        {creating ? (
          <form
            className="flex items-center gap-1.5"
            onSubmit={(event) => {
              event.preventDefault()
              submit()
            }}
          >
            <Input
              autoFocus
              value={title}
              placeholder="会话标题"
              aria-label="会话标题"
              className="h-7 text-xs"
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setCreating(false)
              }}
            />
            <Button size="sm" variant="primary" type="submit" disabled={title.trim().length === 0}>
              创建
            </Button>
            <IconButton label="取消" className="size-7" onClick={() => setCreating(false)}>
              <X className="size-3.5" />
            </IconButton>
          </form>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => setCreating(true)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text disabled:pointer-events-none disabled:opacity-50"
          >
            <SquarePen className="size-3.5 shrink-0 text-faint" />
            新聊天
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {groups.length === 0 ? (
          <p className="px-2 py-3 text-2xs text-faint">还没有会话，点击上方「新聊天」开始。</p>
        ) : (
          groups.map((group) => {
            const isCollapsed = collapsed[group.id] === true
            const Chevron = isCollapsed ? ChevronRight : ChevronDown

            return (
              <div key={group.id} className="mb-0.5">
                <button
                  type="button"
                  aria-expanded={!isCollapsed}
                  onClick={() =>
                    setCollapsed((current) => ({ ...current, [group.id]: !isCollapsed }))
                  }
                  className="group/head flex w-full items-center gap-1 rounded-md px-2 py-1 text-left transition-colors duration-150 hover:bg-surface-hover"
                >
                  <Chevron className="size-3 shrink-0 text-faint" />
                  <span className="truncate text-2xs font-semibold tracking-wider text-faint uppercase">
                    {group.title}
                  </span>
                  <span className="ml-auto shrink-0 text-2xs text-faint">
                    {group.sessions.length}
                  </span>
                </button>

                {!isCollapsed && (
                  <ul className="flex flex-col gap-px">
                    {group.sessions.map((session) => (
                      <SessionRow
                        key={`${group.id}-${session.id}`}
                        session={session}
                        active={session.id === selectedSessionId}
                        menuOpen={menuId === `${group.id}:${session.id}`}
                        busy={busy}
                        projects={projects}
                        sections={sections}
                        onSelect={() => selectSession(session.id)}
                        onToggleMenu={() =>
                          setMenuId(
                            menuId === `${group.id}:${session.id}`
                              ? null
                              : `${group.id}:${session.id}`,
                          )
                        }
                        onPinToggle={() => void setSessionPinned(session.id, !session.pinned)}
                        onProjectChange={(projectId) =>
                          void setSessionProject(session.id, projectId)
                        }
                        onSectionsChange={(sectionIds) =>
                          void setSessionSections(session.id, sectionIds)
                        }
                        onDelete={() => void deleteSession(session.id)}
                      />
                    ))}
                  </ul>
                )}
              </div>
            )
          })
        )}

        <ProjectsPanel />
      </div>
    </section>
  )
}

interface SessionRowProps {
  session: Session
  active: boolean
  menuOpen: boolean
  busy: boolean
  projects: Array<{ id: string; name: string }>
  sections: Array<{ id: string; name: string }>
  onSelect: () => void
  onToggleMenu: () => void
  onPinToggle: () => void
  onProjectChange: (projectId: string | null) => void
  onSectionsChange: (sectionIds: string[]) => void
  onDelete: () => void
}

function SessionRow({
  session,
  active,
  menuOpen,
  busy,
  projects,
  sections,
  onSelect,
  onToggleMenu,
  onPinToggle,
  onProjectChange,
  onSectionsChange,
  onDelete,
}: SessionRowProps): React.JSX.Element {
  return (
    <li className="group/row">
      <div className="relative">
        <button
          type="button"
          onClick={onSelect}
          title={session.title}
          className={cn(
            'flex w-full items-center gap-2 rounded-md py-1.5 pr-12 pl-2 text-left text-xs transition-colors duration-150',
            active
              ? 'bg-surface-raised text-text'
              : 'text-muted hover:bg-surface-hover hover:text-text',
          )}
        >
          <MessageSquare
            className={cn('size-3.5 shrink-0', active ? 'text-accent' : 'text-faint')}
          />
          <span className="truncate">{session.title}</span>
          {session.pinned && <Pin className="size-3 shrink-0 text-accent" />}
        </button>

        <div className="absolute top-0.5 right-0.5 flex items-center opacity-0 group-hover/row:opacity-100 focus-within:opacity-100">
          <IconButton
            label={session.pinned ? '取消置顶' : '置顶'}
            className="size-6"
            disabled={busy}
            onClick={onPinToggle}
          >
            {session.pinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}
          </IconButton>
          <IconButton
            label="会话操作"
            className="size-6"
            aria-expanded={menuOpen}
            onClick={onToggleMenu}
          >
            <ChevronDown className={cn('size-3 transition-transform', menuOpen && 'rotate-180')} />
          </IconButton>
        </div>
      </div>

      {menuOpen && (
        <div className="mt-1 flex flex-col gap-2 rounded-md border border-border bg-surface px-2.5 py-2">
          <label className="flex flex-col gap-1 text-2xs text-faint">
            归属项目
            <select
              value={session.projectId ?? ''}
              onChange={(event) =>
                onProjectChange(event.target.value === '' ? null : event.target.value)
              }
              className="h-7 rounded-sm border border-border bg-bg px-1.5 text-xs text-text"
            >
              <option value="">无项目</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-2xs text-faint">分区</span>
            {sections.length === 0 ? (
              <span className="text-2xs text-faint">还没有分区，可在设置中新建。</span>
            ) : (
              <div className="flex flex-col gap-1">
                {sections.map((section) => {
                  const checked = session.sectionIds.includes(section.id)
                  return (
                    <label key={section.id} className="flex items-center gap-2 text-xs text-muted">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          onSectionsChange(
                            checked
                              ? session.sectionIds.filter((id) => id !== section.id)
                              : [...session.sectionIds, section.id],
                          )
                        }
                        className="size-3 accent-accent"
                      />
                      <span className="truncate">{section.name}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={onDelete}
            className="flex items-center gap-1.5 self-start rounded-sm px-1.5 py-0.5 text-2xs text-danger transition-colors duration-150 hover:bg-danger/10 disabled:opacity-50"
          >
            <Trash2 className="size-3" />
            删除会话
          </button>
        </div>
      )}
    </li>
  )
}
