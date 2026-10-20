import {
  Archive,
  ChevronDown,
  ChevronRight,
  FolderGit2,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  SquarePen,
  Trash2,
} from 'lucide-react'
import { useMemo, useState } from 'react'

import type { Project, Session } from '@pictor/shared'

import { useWorkspaceStore } from '../../app/workspace-store.js'
import { IconButton, Input, Menu, type MenuEntry } from '../../components/ui/index.js'
import { cn } from '../../lib/cn.js'
import {
  collectSectionSessionIds,
  groupSessions,
  type ProjectNode,
  type SectionNode,
  type SectionSort,
} from './grouping.js'

function newSessionTitle(): string {
  const now = new Date()
  return `新会话 ${now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
}

export function SessionsPanel(): React.JSX.Element {
  const sessions = useWorkspaceStore((state) => state.sessions)
  const projects = useWorkspaceStore((state) => state.projects)
  const sections = useWorkspaceStore((state) => state.sections)
  const selectedSessionId = useWorkspaceStore((state) => state.selectedSessionId)
  const sorts = useWorkspaceStore((state) => state.sorts)
  const exclusive = useWorkspaceStore((state) => state.groupingExclusive)
  const busy = useWorkspaceStore((state) => state.busy)

  const selectSession = useWorkspaceStore((state) => state.selectSession)
  const createSession = useWorkspaceStore((state) => state.createSession)
  const deleteSession = useWorkspaceStore((state) => state.deleteSession)
  const setSessionPinned = useWorkspaceStore((state) => state.setSessionPinned)
  const setSessionArchived = useWorkspaceStore((state) => state.setSessionArchived)
  const setSessionSections = useWorkspaceStore((state) => state.setSessionSections)
  const archiveSessions = useWorkspaceStore((state) => state.archiveSessions)
  const createSection = useWorkspaceStore((state) => state.createSection)
  const renameSection = useWorkspaceStore((state) => state.renameSection)
  const removeSection = useWorkspaceStore((state) => state.removeSection)
  const removeProject = useWorkspaceStore((state) => state.removeProject)
  const setSectionSort = useWorkspaceStore((state) => state.setSectionSort)

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null)

  const nodes = useMemo(
    () => groupSessions({ sessions, projects, sections, exclusive, sorts }),
    [sessions, projects, sections, exclusive, sorts],
  )

  function toggle(key: string): void {
    setCollapsed((current) => ({ ...current, [key]: current[key] !== true }))
  }

  async function createIn(sectionId: string | null, projectId: string | null): Promise<void> {
    const created = await createSession(newSessionTitle(), projectId)
    if (created !== null && sectionId !== null) {
      await setSessionSections(created.id, [sectionId])
    }
  }

  function sectionMenu(node: SectionNode): MenuEntry[] {
    if (node.kind === 'archived') return []

    if (node.builtin) {
      const pick = (sort: SectionSort): void => void setSectionSort(node.id, sort)
      return [
        {
          label: '按创建时间排序',
          checked: node.sort === 'created',
          onSelect: () => pick('created'),
        },
        {
          label: '按最后回答时间排序',
          checked: node.sort === 'updated',
          onSelect: () => pick('updated'),
        },
      ]
    }

    const sectionId = node.sectionId ?? ''
    return [
      {
        label: '编辑',
        icon: <Pencil className="size-3" />,
        onSelect: () => setEditing({ id: sectionId, value: node.title }),
      },
      'separator',
      {
        label: '新建分区',
        icon: <Plus className="size-3" />,
        onSelect: () => {
          const name = window.prompt('新分区名称')
          if (name !== null && name.trim().length > 0) void createSection(name.trim())
        },
      },
      {
        label: '归档聊天',
        icon: <Archive className="size-3" />,
        onSelect: () => void archiveSessions(collectSectionSessionIds(node)),
      },
      {
        label: '移除分区',
        icon: <Trash2 className="size-3" />,
        danger: true,
        onSelect: () => void removeSection(sectionId),
      },
    ]
  }

  function projectMenu(project: Project, projectNode: ProjectNode): MenuEntry[] {
    return [
      {
        label: '归档聊天',
        icon: <Archive className="size-3" />,
        onSelect: () => void archiveSessions(projectNode.sessions.map((session) => session.id)),
      },
      {
        label: '移除项目',
        icon: <Trash2 className="size-3" />,
        danger: true,
        onSelect: () => void removeProject(project.id),
      },
    ]
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="px-2 pt-2 pb-1">
        <button
          type="button"
          disabled={busy}
          onClick={() => void createIn(null, null)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text disabled:pointer-events-none disabled:opacity-50"
        >
          <SquarePen className="size-3.5 shrink-0 text-faint" />
          新聊天
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {nodes.map((node) => {
          const isCollapsed = collapsed[node.id] === true
          const Chevron = isCollapsed ? ChevronRight : ChevronDown
          const isEditing = editing !== null && editing.id === node.sectionId

          return (
            <div key={node.id} className="mb-0.5">
              <div className="group/head flex items-center gap-0.5 rounded-md pr-0.5 hover:bg-surface-hover">
                <button
                  type="button"
                  aria-expanded={!isCollapsed}
                  onClick={() => toggle(node.id)}
                  className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-1 text-left"
                >
                  <Chevron className="size-3 shrink-0 text-faint" />
                  {isEditing ? (
                    <Input
                      autoFocus
                      value={editing.value}
                      aria-label="分区名称"
                      className="h-6 text-xs"
                      onChange={(event) =>
                        setEditing({ id: node.sectionId ?? '', value: event.target.value })
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') setEditing(null)
                        if (event.key === 'Enter' && editing.value.trim().length > 0) {
                          void renameSection(node.sectionId ?? '', editing.value.trim())
                          setEditing(null)
                        }
                      }}
                    />
                  ) : (
                    <span className="truncate text-2xs font-semibold tracking-wider text-faint uppercase">
                      {node.title}
                    </span>
                  )}
                  <span className="ml-auto shrink-0 pr-1 text-2xs text-faint">{node.count}</span>
                </button>

                {!isEditing && node.kind !== 'archived' && (
                  <>
                    <Menu
                      label={`${node.title} 更多操作`}
                      trigger={<MoreHorizontal className="size-3.5" />}
                      items={sectionMenu(node)}
                    />
                    <IconButton
                      label={`在${node.title}下新建会话`}
                      className="size-6"
                      disabled={busy}
                      onClick={() => void createIn(node.sectionId, null)}
                    >
                      <Plus className="size-3.5" />
                    </IconButton>
                  </>
                )}
              </div>

              {!isCollapsed && (
                <div className="pl-3">
                  {node.children.map((child) =>
                    child.kind === 'project' ? (
                      <ProjectBlock
                        key={`${node.id}-${child.project.id}`}
                        node={child}
                        sectionKey={node.id}
                        collapsed={collapsed}
                        onToggle={toggle}
                        selectedSessionId={selectedSessionId}
                        busy={busy}
                        menuItems={() => projectMenu(child.project, child)}
                        onCreate={() => void createIn(node.sectionId, child.project.id)}
                        onSelect={selectSession}
                        onPin={(session) => void setSessionPinned(session.id, !session.pinned)}
                        onArchive={(session) => void setSessionArchived(session.id, true)}
                        onDelete={(session) => void deleteSession(session.id)}
                      />
                    ) : (
                      <SessionRow
                        key={`${node.id}-${child.session.id}`}
                        session={child.session}
                        active={child.session.id === selectedSessionId}
                        busy={busy}
                        onSelect={() => selectSession(child.session.id)}
                        onPin={() => void setSessionPinned(child.session.id, !child.session.pinned)}
                        onArchive={() => void setSessionArchived(child.session.id, true)}
                        onDelete={() => void deleteSession(child.session.id)}
                        indent={0}
                      />
                    ),
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function ProjectBlock({
  node,
  sectionKey,
  collapsed,
  onToggle,
  selectedSessionId,
  busy,
  menuItems,
  onCreate,
  onSelect,
  onPin,
  onArchive,
  onDelete,
}: {
  node: ProjectNode
  sectionKey: string
  collapsed: Record<string, boolean>
  onToggle: (key: string) => void
  selectedSessionId: string | null
  busy: boolean
  menuItems: () => MenuEntry[]
  onCreate: () => void
  onSelect: (id: string) => void
  onPin: (session: Session) => void
  onArchive: (session: Session) => void
  onDelete: (session: Session) => void
}): React.JSX.Element {
  const key = `${sectionKey}-project-${node.project.id}`
  const isCollapsed = collapsed[key] === true
  const Chevron = isCollapsed ? ChevronRight : ChevronDown

  return (
    <div className="mb-0.5">
      <div className="group/head flex items-center gap-0.5 rounded-md pr-0.5 hover:bg-surface-hover">
        <button
          type="button"
          aria-expanded={!isCollapsed}
          onClick={() => onToggle(key)}
          title={node.project.path}
          className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-1 text-left"
        >
          <Chevron className="size-3 shrink-0 text-faint" />
          <FolderGit2 className="size-3.5 shrink-0 text-faint" />
          <span className="truncate text-xs text-muted">{node.project.name}</span>
          <span className="ml-auto shrink-0 pr-1 text-2xs text-faint">{node.sessions.length}</span>
        </button>

        <Menu
          label={`${node.project.name} 更多操作`}
          trigger={<MoreHorizontal className="size-3.5" />}
          items={menuItems()}
        />
        <IconButton
          label={`在${node.project.name}下新建会话`}
          className="size-6"
          disabled={busy}
          onClick={onCreate}
        >
          <Plus className="size-3.5" />
        </IconButton>
      </div>

      {!isCollapsed && (
        <div className="pl-4">
          {node.sessions.length === 0 ? (
            <p className="px-2 py-1 text-2xs text-faint">还没有会话</p>
          ) : (
            node.sessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                active={session.id === selectedSessionId}
                busy={busy}
                onSelect={() => onSelect(session.id)}
                onPin={() => onPin(session)}
                onArchive={() => onArchive(session)}
                onDelete={() => onDelete(session)}
                indent={0}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

function SessionRow({
  session,
  active,
  busy,
  onSelect,
  onPin,
  onArchive,
  onDelete,
  indent,
}: {
  session: Session
  active: boolean
  busy: boolean
  onSelect: () => void
  onPin: () => void
  onArchive: () => void
  onDelete: () => void
  indent: number
}): React.JSX.Element {
  return (
    <div className="group/row relative">
      <button
        type="button"
        onClick={onSelect}
        title={session.title}
        style={{ paddingLeft: `${String(8 + indent * 4)}px` }}
        className={cn(
          'flex w-full items-center gap-2 rounded-md py-1.5 pr-14 text-left text-xs transition-colors duration-150',
          active
            ? 'bg-surface-raised text-text'
            : 'text-muted hover:bg-surface-hover hover:text-text',
        )}
      >
        <MessageSquare className={cn('size-3.5 shrink-0', active ? 'text-accent' : 'text-faint')} />
        <span className="truncate">{session.title}</span>
        {session.pinned && <Pin className="size-3 shrink-0 text-accent" />}
      </button>

      <div className="absolute top-0.5 right-0.5 flex items-center opacity-0 group-hover/row:opacity-100 focus-within:opacity-100">
        <IconButton
          label={session.pinned ? '取消置顶' : '置顶'}
          className="size-6"
          disabled={busy}
          onClick={onPin}
        >
          {session.pinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}
        </IconButton>
        <Menu
          label={`${session.title} 更多操作`}
          trigger={<MoreHorizontal className="size-3.5" />}
          items={[
            { label: '归档聊天', icon: <Archive className="size-3" />, onSelect: onArchive },
            {
              label: '删除会话',
              icon: <Trash2 className="size-3" />,
              danger: true,
              onSelect: onDelete,
            },
          ]}
        />
      </div>
    </div>
  )
}
