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
import { useMemo, useState, type ReactNode } from 'react'
import type { Project, Session } from '@pictor/shared'

import { useWorkspaceStore } from '../../app/workspace-store.js'
import {
  Button,
  Dialog,
  IconButton,
  Input,
  Menu,
  type MenuEntry,
} from '../../components/ui/index.js'
import { cn } from '../../lib/cn.js'
import {
  collectSectionSessionIds,
  groupSessions,
  PROJECTS_ID,
  type ProjectNode,
  type SectionNode,
  type SectionSort,
} from './grouping.js'

function newSessionTitle(): string {
  const now = new Date()
  return `新会话 ${now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
}

type Dragged =
  | { kind: 'section'; id: string }
  | { kind: 'project'; id: string; sectionId: string | null }
  | { kind: 'session'; id: string; sectionId: string | null }

/**
 * Animated disclosure for the sidebar tree.
 *
 * The content stays mounted so the height transition has something to measure;
 * `inert` keeps the collapsed rows out of the tab order and the accessibility
 * tree. base.css already neutralises the transition under reduced motion.
 */
function Collapse({ open, children }: { open: boolean; children: ReactNode }): React.JSX.Element {
  return (
    <div
      className={cn(
        'grid transition-[grid-template-rows,opacity] duration-200 ease-out',
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
      )}
    >
      <div className="min-h-0 overflow-hidden" inert={!open}>
        {children}
      </div>
    </div>
  )
}
const DRAG_TYPE = 'application/x-pictor-item'

/** A destructive action waiting for confirmation. */
type PendingDelete =
  { kind: 'project'; id: string; title: string } | { kind: 'session'; id: string; title: string }

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
  const setSessionProject = useWorkspaceStore((state) => state.setSessionProject)
  const setProjectSection = useWorkspaceStore((state) => state.setProjectSection)
  const archiveSessions = useWorkspaceStore((state) => state.archiveSessions)
  const reorderSessions = useWorkspaceStore((state) => state.reorderSessions)
  const createSection = useWorkspaceStore((state) => state.createSection)
  const renameSection = useWorkspaceStore((state) => state.renameSection)
  const removeSection = useWorkspaceStore((state) => state.removeSection)
  const removeProject = useWorkspaceStore((state) => state.removeProject)
  const setSectionSort = useWorkspaceStore((state) => state.setSectionSort)
  const reorderSections = useWorkspaceStore((state) => state.reorderSections)

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [gapIndex, setGapIndex] = useState<number | null>(null)
  const [dragging, setDragging] = useState<Dragged | null>(null)
  const [confirm, setConfirm] = useState<PendingDelete | null>(null)

  function askDelete(target: PendingDelete): void {
    setConfirm(target)
  }

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

  function beginDrag(event: React.DragEvent, payload: Dragged): void {
    setDragging(payload)
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(payload))
    event.dataTransfer.effectAllowed = 'move'
  }

  function endDrag(): void {
    setDragging(null)
    setDragOver(null)
  }

  function readDrag(event: React.DragEvent): Dragged | null {
    const raw = event.dataTransfer.getData(DRAG_TYPE)
    if (raw.length === 0) return dragging
    try {
      return JSON.parse(raw) as Dragged
    } catch {
      return dragging
    }
  }

  /** A session dropped on a section: pin it, tag it, or detach it from a project. */
  async function dropSessionInSection(node: SectionNode, sessionId: string): Promise<void> {
    if (node.kind === 'pinned') {
      await setSessionPinned(sessionId, true)
      return
    }
    if (node.kind === 'projects') {
      await setSessionProject(sessionId, null)
      return
    }
    if (node.kind === 'custom' && node.sectionId !== null) {
      await setSessionSections(sessionId, [node.sectionId])
    }
  }

  function reorderAround(targetId: string, draggedId: string): void {
    const ids = sections
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((section) => section.id)
      .filter((id) => id !== draggedId)

    const index = ids.indexOf(targetId)
    const next = [
      ...ids.slice(0, index === -1 ? ids.length : index),
      draggedId,
      ...(index === -1 ? [] : ids.slice(index)),
    ]
    void reorderSections(next)
  }

  const customSections = [...sections].sort((a, b) => a.position - b.position)
  const draggingSection = dragging?.kind === 'section'

  /** Drops the dragged section at `index` among the custom sections. */
  function dropAtGap(index: number): void {
    const dragged = dragging
    setGapIndex(null)
    endDrag()
    if (dragged === null || dragged.kind !== 'section') return

    const order = customSections.map((section) => section.id).filter((id) => id !== dragged.id)
    order.splice(Math.min(index, order.length), 0, dragged.id)
    void reorderSections(order)
  }

  /** Session ids of a section in the order they are rendered. */
  function orderedSessionIds(node: SectionNode): string[] {
    const ids: string[] = []
    for (const child of node.children) {
      if (child.kind === 'project') {
        for (const session of child.sessions) ids.push(session.id)
      } else {
        ids.push(child.session.id)
      }
    }
    return ids
  }

  /** Re-inserts a dragged session right above `targetId` and pins the order. */
  async function dropSessionOn(
    node: SectionNode,
    draggedId: string,
    targetId: string,
  ): Promise<void> {
    if (draggedId === targetId) return

    const ids = orderedSessionIds(node).filter((id) => id !== draggedId)
    const index = ids.indexOf(targetId)
    ids.splice(index === -1 ? ids.length : index, 0, draggedId)

    await reorderSessions(ids)
    await setSectionSort(node.id, 'manual')
  }

  /** Sliver rendered between two sections; only while dragging a section. */
  function gapElement(index: number): React.JSX.Element {
    const active = gapIndex === index
    return (
      <div
        role="separator"
        aria-label="插入到此位置"
        onDragOver={(event) => {
          event.preventDefault()
          setGapIndex(index)
        }}
        onDragLeave={() => setGapIndex((current) => (current === index ? null : current))}
        onDrop={(event) => {
          event.preventDefault()
          event.stopPropagation()
          dropAtGap(index)
        }}
        className={cn('relative -my-0.5 h-2', active ? 'bg-accent/60' : 'bg-transparent')}
      />
    )
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
        { label: '手动排序', checked: node.sort === 'manual', onSelect: () => pick('manual') },
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
        onSelect: () => askDelete({ kind: 'project', id: project.id, title: project.name }),
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
          const isTarget = dragOver === node.id
          const gapBefore =
            node.kind === 'custom'
              ? customSections.findIndex((section) => section.id === node.sectionId)
              : node.kind === 'archived'
                ? customSections.length
                : -1

          return (
            <div key={node.id} className="mb-0.5">
              {draggingSection && gapBefore >= 0 && gapElement(gapBefore)}
              <div
                onDragOver={(event) => {
                  if (node.kind === 'archived' || node.kind === 'recent') return
                  event.preventDefault()
                  setDragOver(node.id)
                }}
                onDragLeave={() => setDragOver((current) => (current === node.id ? null : current))}
                onDrop={(event) => {
                  if (node.kind === 'archived' || node.kind === 'recent') return
                  event.preventDefault()
                  const dragged = readDrag(event)
                  endDrag()
                  if (dragged === null) return

                  if (dragged.kind === 'section') {
                    if (node.kind === 'custom') reorderAround(node.sectionId ?? '', dragged.id)
                    return
                  }
                  if (dragged.kind === 'project') {
                    void setProjectSection(
                      dragged.id,
                      node.kind === PROJECTS_ID ? null : node.sectionId,
                    )
                    return
                  }
                  void dropSessionInSection(node, dragged.id)
                }}
                className={cn(
                  'group/head flex items-center gap-0.5 rounded-md pr-0.5 transition-colors duration-150 hover:bg-surface-hover',
                  isTarget && 'ring-1 ring-accent/50',
                )}
              >
                <button
                  type="button"
                  aria-expanded={!isCollapsed}
                  onClick={() => toggle(node.id)}
                  draggable={node.kind === 'custom'}
                  onDragStart={(event) =>
                    beginDrag(event, { kind: 'section', id: node.sectionId ?? '' })
                  }
                  onDragEnd={endDrag}
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
                </button>

                {!isEditing && node.kind !== 'archived' && (
                  <div className="flex items-center opacity-0 transition-opacity group-hover/head:opacity-100 focus-within:opacity-100">
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
                  </div>
                )}
              </div>

              <Collapse open={!isCollapsed}>
                <div className="pl-3">
                  {node.children.map((child) =>
                    child.kind === 'project' ? (
                      <ProjectBlock
                        key={`${node.id}-${child.project.id}`}
                        node={child}
                        collapsed={collapsed}
                        onToggle={toggle}
                        selectedSessionId={selectedSessionId}
                        busy={busy}
                        dragOver={dragOver}
                        setDragOver={setDragOver}
                        beginDrag={beginDrag}
                        endDrag={endDrag}
                        readDrag={readDrag}
                        menuItems={() => projectMenu(child.project, child)}
                        onCreate={() => void createIn(node.sectionId, child.project.id)}
                        onSelect={selectSession}
                        onPin={(session) => void setSessionPinned(session.id, !session.pinned)}
                        onArchive={(session) => void setSessionArchived(session.id, true)}
                        onDelete={(session) =>
                          askDelete({ kind: 'session', id: session.id, title: session.title })
                        }
                        onDropSession={(sessionId) =>
                          void setSessionProject(sessionId, child.project.id)
                        }
                        onDropProject={(projectId) =>
                          void setProjectSection(
                            projectId,
                            node.kind === PROJECTS_ID ? null : node.sectionId,
                          )
                        }
                        onReorderSession={(draggedId, targetId) =>
                          void dropSessionOn(node, draggedId, targetId)
                        }
                      />
                    ) : (
                      <SessionRow
                        key={`${node.id}-${child.session.id}`}
                        session={child.session}
                        active={child.session.id === selectedSessionId}
                        busy={busy}
                        sectionId={node.sectionId}
                        onSelect={() => selectSession(child.session.id)}
                        onPin={() => void setSessionPinned(child.session.id, !child.session.pinned)}
                        onArchive={() => void setSessionArchived(child.session.id, true)}
                        onDelete={() =>
                          askDelete({
                            kind: 'session',
                            id: child.session.id,
                            title: child.session.title,
                          })
                        }
                        onDragStart={(event) =>
                          beginDrag(event, {
                            kind: 'session',
                            id: child.session.id,
                            sectionId: node.sectionId,
                          })
                        }
                        onDragEnd={endDrag}
                        readDrag={readDrag}
                        onDropSession={(draggedId) =>
                          void dropSessionOn(node, draggedId, child.session.id)
                        }
                      />
                    ),
                  )}
                </div>
              </Collapse>
            </div>
          )
        })}

        {draggingSection && nodes.every((node) => node.kind !== 'archived') && (
          <div className="px-1">{gapElement(customSections.length)}</div>
        )}
      </div>
      <Dialog
        open={confirm !== null}
        title={confirm?.kind === 'project' ? '移除项目' : '删除会话'}
        onClose={() => setConfirm(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              取消
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (confirm === null) return
                const target = confirm
                setConfirm(null)
                if (target.kind === 'project') void removeProject(target.id)
                else void deleteSession(target.id)
              }}
            >
              {confirm?.kind === 'project' ? '移除项目' : '删除会话'}
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-muted">
          {confirm?.kind === 'project'
            ? `「${confirm.title}」及其下的会话都会被移除，此操作不可撤销。`
            : `「${confirm?.title ?? ''}」的对话记录会被删除，此操作不可撤销。`}
        </p>
      </Dialog>
    </section>
  )
}

function ProjectBlock({
  node,
  collapsed,
  onToggle,
  selectedSessionId,
  busy,
  dragOver,
  setDragOver,
  beginDrag,
  endDrag,
  readDrag,
  menuItems,
  onCreate,
  onSelect,
  onPin,
  onArchive,
  onDelete,
  onDropSession,
  onDropProject,
  onReorderSession,
}: {
  node: ProjectNode
  collapsed: Record<string, boolean>
  onToggle: (key: string) => void
  selectedSessionId: string | null
  busy: boolean
  dragOver: string | null
  setDragOver: (value: string | null) => void
  beginDrag: (event: React.DragEvent, payload: Dragged) => void
  endDrag: () => void
  readDrag: (event: React.DragEvent) => Dragged | null
  menuItems: () => MenuEntry[]
  onCreate: () => void
  onSelect: (id: string) => void
  onPin: (session: Session) => void
  onArchive: (session: Session) => void
  onDelete: (session: Session) => void
  onDropSession: (sessionId: string) => void
  onDropProject: (projectId: string) => void
  onReorderSession: (draggedId: string, targetId: string) => void
}): React.JSX.Element {
  const key = `project-${node.project.id}`
  const isCollapsed = collapsed[key] === true
  const Chevron = isCollapsed ? ChevronRight : ChevronDown
  const isTarget = dragOver === key

  return (
    <div className="mb-0.5">
      <div
        onDragOver={(event) => {
          event.preventDefault()
          setDragOver(key)
        }}
        onDragLeave={() => setDragOver(null)}
        onDrop={(event) => {
          event.preventDefault()
          const dragged = readDrag(event)
          endDrag()
          if (dragged === null) return
          if (dragged.kind === 'session') onDropSession(dragged.id)
          if (dragged.kind === 'project' && dragged.id !== node.project.id)
            onDropProject(dragged.id)
        }}
        className={cn(
          'group/head flex items-center gap-0.5 rounded-md pr-0.5 transition-colors duration-150 hover:bg-surface-hover',
          isTarget && 'ring-1 ring-accent/50',
        )}
      >
        <button
          type="button"
          aria-expanded={!isCollapsed}
          onClick={() => onToggle(key)}
          title={node.project.path}
          draggable
          onDragStart={(event) =>
            beginDrag(event, {
              kind: 'project',
              id: node.project.id,
              sectionId: node.project.sectionId,
            })
          }
          onDragEnd={endDrag}
          className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-1 text-left"
        >
          <Chevron className="size-3 shrink-0 text-faint" />
          <FolderGit2 className="size-3.5 shrink-0 text-faint" />
          <span className="truncate text-xs text-muted">{node.project.name}</span>
        </button>

        <div className="flex items-center opacity-0 transition-opacity group-hover/head:opacity-100 focus-within:opacity-100">
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
      </div>

      <Collapse open={!isCollapsed}>
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
                sectionId={node.project.sectionId}
                onSelect={() => onSelect(session.id)}
                onPin={() => onPin(session)}
                onArchive={() => onArchive(session)}
                onDelete={() => onDelete(session)}
                onDragStart={(event) =>
                  beginDrag(event, {
                    kind: 'session',
                    id: session.id,
                    sectionId: node.project.sectionId,
                  })
                }
                onDragEnd={endDrag}
                readDrag={readDrag}
                onDropSession={(draggedId) => onReorderSession(draggedId, session.id)}
              />
            ))
          )}
        </div>
      </Collapse>
    </div>
  )
}

function SessionRow({
  session,
  active,
  busy,
  sectionId,
  onSelect,
  onPin,
  onArchive,
  onDelete,
  onDragStart,
  onDragEnd,
  readDrag,
  onDropSession,
}: {
  session: Session
  active: boolean
  busy: boolean
  sectionId: string | null
  onSelect: () => void
  onPin: () => void
  onArchive: () => void
  onDelete: () => void
  onDragStart: (event: React.DragEvent) => void
  onDragEnd: () => void
  readDrag: (event: React.DragEvent) => Dragged | null
  onDropSession: (draggedId: string) => void
}): React.JSX.Element {
  const [over, setOver] = useState(false)

  return (
    <div
      className={cn('group/row relative rounded-md', over && 'ring-1 ring-accent/50')}
      onDragOver={(event) => {
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault()
        event.stopPropagation()
        const dragged = readDrag(event)
        setOver(false)
        if (dragged !== null && dragged.kind === 'session') onDropSession(dragged.id)
      }}
    >
      <button
        type="button"
        onClick={onSelect}
        title={session.title}
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        data-section={sectionId ?? ''}
        className={cn(
          'flex w-full items-center gap-2 rounded-md py-1.5 pr-12 pl-2 text-left text-xs transition-colors duration-150',
          active
            ? 'bg-surface-raised text-text'
            : 'text-muted hover:bg-surface-hover hover:text-text',
        )}
      >
        <MessageSquare className={cn('size-3.5 shrink-0', active ? 'text-accent' : 'text-faint')} />
        <span className="truncate">{session.title}</span>
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
