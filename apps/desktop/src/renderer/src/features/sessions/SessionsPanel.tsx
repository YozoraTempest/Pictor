import {
  Archive,
  ChevronDown,
  ChevronRight,
  FolderGit2,
  Loader2,
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
import { useChatStore } from '../chat/chat-store.js'
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
  moveSectionOrder,
  PROJECTS_ID,
  type ProjectNode,
  type SectionNode,
  sectionKey,
  type SectionSort,
} from './grouping.js'

type Dragged =
  | { kind: 'section'; id: string }
  | { kind: 'project'; id: string; sectionId: string | null }
  | { kind: 'session'; id: string; sectionId: string | null }

/**
 * Where a drag would land: `before` / `after` insert the dragged item next to
 * an existing row, `into` files it inside a section or a project.
 *
 * Keys are namespaced because section keys, project ids and session ids all
 * live in one namespace — a bare id could match the wrong kind of row.
 */
type DropTarget = { key: string; edge: 'before' | 'after' | 'into' }

const sectionTarget = (key: string): string => `section:${key}`
const projectTarget = (id: string): string => `project:${id}`
const sessionTarget = (id: string): string => `session:${id}`

/** Which half of the hovered row the pointer is over. */
function dropEdge(event: React.DragEvent<HTMLElement>): 'before' | 'after' {
  const rect = event.currentTarget.getBoundingClientRect()
  return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

/**
 * Whether the pointer actually left the element.
 *
 * `dragleave` also fires when the pointer moves onto a child element, which
 * used to clear the preview and made the line flicker on every row.
 */
function pointerLeft(event: React.DragEvent<HTMLElement>): boolean {
  const rect = event.currentTarget.getBoundingClientRect()
  return (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  )
}

/**
 * The insertion preview shared by every row-level drop target.
 *
 * One pixel, absolutely positioned and pointer-transparent: showing it must
 * never reflow the list, and it must not steal the hover from the row.
 */
function InsertLine({
  edge,
  show,
}: {
  edge: 'before' | 'after'
  show: boolean
}): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-x-1 h-px bg-text/70 transition-opacity duration-100',
        edge === 'before' ? 'top-0' : 'bottom-0',
        show ? 'opacity-100' : 'opacity-0',
      )}
    />
  )
}
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
  const groupingMode = useWorkspaceStore((state) => state.groupingMode)
  const sectionOrder = useWorkspaceStore((state) => state.sectionOrder)
  const setSectionOrder = useWorkspaceStore((state) => state.setSectionOrder)
  const busy = useWorkspaceStore((state) => state.busy)

  const selectSession = useWorkspaceStore((state) => state.selectSession)
  const startDraft = useWorkspaceStore((state) => state.startDraft)
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

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null)
  /** What the pointer is over right now; drives every drop preview. */
  const [target, setTarget] = useState<DropTarget | null>(null)
  const [dragging, setDragging] = useState<Dragged | null>(null)
  const [confirm, setConfirm] = useState<PendingDelete | null>(null)

  function askDelete(target: PendingDelete): void {
    setConfirm(target)
  }

  const nodes = useMemo(
    () =>
      groupSessions({
        sessions,
        projects,
        sections,
        mode: groupingMode,
        order: sectionOrder,
        sorts,
      }),
    [sessions, projects, sections, groupingMode, sectionOrder, sorts],
  )

  function toggle(key: string): void {
    setCollapsed((current) => ({ ...current, [key]: current[key] !== true }))
  }

  function createIn(sectionId: string | null, projectId?: string | null): void {
    startDraft({ sectionId, projectId })
  }

  function beginDrag(event: React.DragEvent, payload: Dragged): void {
    setDragging(payload)
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(payload))
    event.dataTransfer.effectAllowed = 'move'
  }

  function endDrag(): void {
    setDragging(null)
    setTarget(null)
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

  /**
   * Marks `next` as the landing spot.
   *
   * Identical targets are ignored so hovering inside one row does not re-render
   * the whole tree on every mousemove, which is what made the preview flicker.
   */
  function markTarget(next: DropTarget): void {
    setTarget((current) =>
      current !== null && current.key === next.key && current.edge === next.edge ? current : next,
    )
  }

  /** Clears the preview only when `key` is still the active target. */
  function clearTarget(key: string): void {
    setTarget((current) => (current !== null && current.key === key ? null : current))
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

  const draggingSection = dragging?.kind === 'section'
  /** Sections the user can reorder; 已归档 is pinned to the bottom. */
  const movableSections = nodes.filter((node) => node.kind !== 'archived')
  const movableIndex = (node: SectionNode): number =>
    movableSections.findIndex((entry) => sectionKey(entry) === sectionKey(node))

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

  /**
   * Re-inserts a dragged session next to `targetId` and pins the order.
   *
   * `edge` is why the preview line matters: dropping on the lower half of a row
   * lands after it, so a session can also be dragged downwards.
   */
  async function dropSessionOn(
    node: SectionNode,
    draggedId: string,
    targetId: string,
    edge: 'before' | 'after',
  ): Promise<void> {
    if (draggedId === targetId) return

    const ids = orderedSessionIds(node).filter((id) => id !== draggedId)
    const index = ids.indexOf(targetId)
    if (index === -1) ids.push(draggedId)
    else ids.splice(edge === 'after' ? index + 1 : index, 0, draggedId)

    await reorderSessions(ids)
    await setSectionSort(node.id, 'manual')
  }
  /**
   * Reorders every section — built-ins included — through one rule.
   *
   * The rebuild lives in `moveSectionOrder` so it is testable; `null` means the
   * move cannot be expressed and nothing is written. `edge` says which side of
   * the target wins, so 置顶 moves down like any other section.
   */
  function moveSection(
    draggedKey: string,
    targetKey: string | null,
    edge: 'before' | 'after' = 'before',
  ): void {
    const order = moveSectionOrder(movableSections.map(sectionKey), draggedKey, targetKey, edge)
    if (order !== null) void setSectionOrder(order)
  }

  /**
   * Hit area between two sections: `beforeKey` is the section it sits above,
   * and `null` is the trailing gap after the last movable section.
   *
   * The gaps between sections are absolutely positioned, so opening them during
   * a drag moves nothing: the old preview added blocks to the flow and the whole
   * list shifted the moment a section drag started.
   */
  function gapElement(beforeKey: string | null): React.JSX.Element {
    const key = sectionTarget(beforeKey ?? '')
    const active = target !== null && target.key === key && target.edge === 'before'
    return (
      <div
        role="separator"
        aria-label="插入到此位置"
        onDragOver={(event) => {
          if (dragging?.kind !== 'section') return
          event.preventDefault()
          event.stopPropagation()
          markTarget({ key, edge: 'before' })
        }}
        onDragLeave={(event) => {
          if (pointerLeft(event)) clearTarget(key)
        }}
        onDrop={(event) => {
          if (dragging?.kind !== 'section') return
          event.preventDefault()
          event.stopPropagation()
          const dragged = readDrag(event)
          endDrag()
          if (dragged === null || dragged.kind !== 'section') return
          moveSection(dragged.id, beforeKey)
        }}
        className={cn(
          beforeKey === null ? 'relative h-1.5' : 'absolute inset-x-0 -top-1.5 z-10 h-3',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-x-1 top-1/2 h-px -translate-y-1/2 bg-text/70 transition-opacity duration-100',
            active ? 'opacity-100' : 'opacity-0',
          )}
        />
      </div>
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
          onClick={() => createIn(null)}
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
          const key = sectionTarget(sectionKey(node))
          const mine = target !== null && target.key === key ? target.edge : null
          const gapBefore = node.kind === 'archived' ? -1 : movableIndex(node)
          const gapAbove = gapBefore >= 0 ? movableSections[gapBefore] : undefined

          return (
            <div key={node.id} className="relative mb-0.5">
              {draggingSection && gapAbove !== undefined && gapElement(sectionKey(gapAbove))}
              <div
                onDragOver={(event) => {
                  if (node.kind === 'archived' || dragging === null) return
                  event.preventDefault()
                  event.stopPropagation()
                  markTarget({ key, edge: dragging.kind === 'section' ? dropEdge(event) : 'into' })
                }}
                onDragLeave={(event) => {
                  if (pointerLeft(event)) clearTarget(key)
                }}
                onDrop={(event) => {
                  if (node.kind === 'archived' || dragging === null) return
                  event.preventDefault()
                  event.stopPropagation()
                  const edge = dragging.kind === 'section' ? dropEdge(event) : 'into'
                  const dragged = readDrag(event)
                  endDrag()
                  if (dragged === null) return

                  if (dragged.kind === 'section') {
                    // Dropping a section on another one reorders them: the
                    // pointer half decides whether it lands before or after the
                    // target, so the topmost section can also move down.
                    moveSection(dragged.id, sectionKey(node), edge === 'after' ? 'after' : 'before')
                    return
                  }
                  // 最近 is the timeline: it takes no tags and no projects.
                  if (node.kind === 'recent') return
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
                  'group/head relative flex items-center gap-0.5 rounded-md pr-0.5 transition-colors duration-150 hover:bg-surface-hover',
                  mine === 'into' && 'ring-1 ring-accent',
                )}
              >
                <button
                  type="button"
                  aria-expanded={!isCollapsed}
                  onClick={() => toggle(node.id)}
                  draggable={node.kind !== 'archived'}
                  onDragStart={(event) =>
                    beginDrag(event, { kind: 'section', id: sectionKey(node) })
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
                      onClick={() => createIn(node.sectionId)}
                    >
                      <Plus className="size-3.5" />
                    </IconButton>
                  </div>
                )}
                <InsertLine edge="after" show={mine === 'after'} />
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
                        target={target}
                        dragging={dragging}
                        markTarget={markTarget}
                        clearTarget={clearTarget}
                        beginDrag={beginDrag}
                        endDrag={endDrag}
                        readDrag={readDrag}
                        menuItems={() => projectMenu(child.project, child)}
                        onCreate={() => createIn(node.sectionId, child.project.id)}
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
                        onReorderSession={(draggedId, targetId, edge) =>
                          void dropSessionOn(node, draggedId, targetId, edge)
                        }
                      />
                    ) : (
                      <SessionRow
                        key={`${node.id}-${child.session.id}`}
                        session={child.session}
                        active={child.session.id === selectedSessionId}
                        busy={busy}
                        sectionId={node.sectionId}
                        target={target}
                        dragging={dragging}
                        markTarget={markTarget}
                        clearTarget={clearTarget}
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
                        onDropSession={(draggedId, edge) =>
                          void dropSessionOn(node, draggedId, child.session.id, edge)
                        }
                      />
                    ),
                  )}
                </div>
              </Collapse>
            </div>
          )
        })}

        {draggingSection && gapElement(null)}
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
  target,
  dragging,
  markTarget,
  clearTarget,
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
  target: DropTarget | null
  dragging: Dragged | null
  markTarget: (next: DropTarget) => void
  clearTarget: (key: string) => void
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
  onReorderSession: (draggedId: string, targetId: string, edge: 'before' | 'after') => void
}): React.JSX.Element {
  const key = `project-${node.project.id}`
  const isCollapsed = collapsed[key] === true
  const Chevron = isCollapsed ? ChevronRight : ChevronDown
  const dropKey = projectTarget(node.project.id)
  // Only a session or a project can be filed here; the ring marks the project
  // itself, without also lighting up the section that contains it.
  const isTarget = target !== null && target.key === dropKey

  return (
    <div className="mb-0.5">
      <div
        onDragOver={(event) => {
          if (dragging === null || dragging.kind === 'section') return
          event.preventDefault()
          event.stopPropagation()
          markTarget({ key: dropKey, edge: 'into' })
        }}
        onDragLeave={(event) => {
          if (pointerLeft(event)) clearTarget(dropKey)
        }}
        onDrop={(event) => {
          if (dragging === null || dragging.kind === 'section') return
          event.preventDefault()
          event.stopPropagation()
          const dragged = readDrag(event)
          clearTarget(dropKey)
          if (dragged === null) return
          if (dragged.kind === 'session') onDropSession(dragged.id)
          if (dragged.kind === 'project' && dragged.id !== node.project.id)
            onDropProject(dragged.id)
        }}
        className={cn(
          'group/head flex items-center gap-0.5 rounded-md pr-0.5 transition-colors duration-150 hover:bg-surface-hover',
          isTarget && 'ring-1 ring-accent',
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
                target={target}
                dragging={dragging}
                markTarget={markTarget}
                clearTarget={clearTarget}
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
                onDropSession={(draggedId, edge) => onReorderSession(draggedId, session.id, edge)}
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
  target,
  dragging,
  markTarget,
  clearTarget,
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
  target: DropTarget | null
  dragging: Dragged | null
  markTarget: (next: DropTarget) => void
  clearTarget: (key: string) => void
  onSelect: () => void
  onPin: () => void
  onArchive: () => void
  onDelete: () => void
  onDragStart: (event: React.DragEvent) => void
  onDragEnd: () => void
  readDrag: (event: React.DragEvent) => Dragged | null
  onDropSession: (draggedId: string, edge: 'before' | 'after') => void
}): React.JSX.Element {
  const running = useChatStore((state) => state.chats[session.id]?.running === true)
  const key = sessionTarget(session.id)
  const line = target !== null && target.key === key && target.edge !== 'into' ? target.edge : null

  return (
    <div
      className="group/row relative rounded-md"
      onDragOver={(event) => {
        if (dragging === null || dragging.kind !== 'session') return
        if (dragging.id === session.id) {
          clearTarget(key)
          return
        }
        event.preventDefault()
        event.stopPropagation()
        markTarget({ key, edge: dropEdge(event) })
      }}
      onDragLeave={(event) => {
        if (pointerLeft(event)) clearTarget(key)
      }}
      onDrop={(event) => {
        if (dragging === null || dragging.kind !== 'session') return
        event.preventDefault()
        event.stopPropagation()
        const edge = dropEdge(event)
        const dragged = readDrag(event)
        clearTarget(key)
        if (dragged !== null && dragged.kind === 'session') onDropSession(dragged.id, edge)
      }}
    >
      {line !== null && <InsertLine edge={line} show />}
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
        {running ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-accent" aria-label="正在运行" />
        ) : (
          <MessageSquare
            className={cn('size-3.5 shrink-0', active ? 'text-accent' : 'text-faint')}
          />
        )}
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
