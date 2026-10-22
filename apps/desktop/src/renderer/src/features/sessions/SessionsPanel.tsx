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
import { Fragment, useMemo, useState, type ReactNode } from 'react'
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
 * One insertion slot: an index inside a list, not a side of a row.
 *
 * The bottom half of a row and the top half of the row below resolve to the
 * same slot, so a boundary can only ever draw one line. Every slot belongs to
 * one list, which is why all lines inside that list share the same width.
 */
type GapRef = { list: string; gap: number }

/** Where a drag would land: inside a container, or in one of its slots. */
type DropTarget = { kind: 'into'; list: string } | ({ kind: 'insert' } & GapRef)

/** The top-level list of sections; the other lists are per section or project. */
const SECTION_LIST = 'sections'
const sectionList = (key: string): string => `section:${key}`
const projectList = (id: string): string => `project:${id}`

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
 * The one line a list draws for a slot.
 *
 * A zero-height block, so the line sits exactly on the boundary and adds no
 * layout: nothing moves while a drag is in flight, and the line spans the full
 * width of the list that owns the slot.
 */
function InsertGap({ show }: { show: boolean }): React.JSX.Element {
  return (
    <div className="relative h-0">
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 h-px bg-text/70 transition-opacity duration-100',
          show ? 'opacity-100' : 'opacity-0',
        )}
      />
    </div>
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
   * Marks the slot under the pointer.
   *
   * Identical targets are ignored so hovering inside one row does not re-render
   * the whole tree on every mousemove.
   */
  function markInsert(next: GapRef): void {
    setTarget((current) =>
      current !== null &&
      current.kind === 'insert' &&
      current.list === next.list &&
      current.gap === next.gap
        ? current
        : { kind: 'insert', list: next.list, gap: next.gap },
    )
  }

  /** Marks a container that would receive the dragged item. */
  function markInto(list: string): void {
    setTarget((current) =>
      current !== null && current.kind === 'into' && current.list === list
        ? current
        : { kind: 'into', list },
    )
  }

  function clearPreview(): void {
    setTarget((current) => (current === null ? current : null))
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

  /** Sections the user can reorder; 已归档 is pinned to the bottom. */
  const movableSections = nodes.filter((node) => node.kind !== 'archived')
  const movableIndex = (node: SectionNode): number =>
    movableSections.findIndex((entry) => sectionKey(entry) === sectionKey(node))

  /** Where the dragged section sits now; -1 when no section is being dragged. */
  const draggedSectionOrder =
    dragging?.kind === 'section'
      ? movableSections.findIndex((entry) => sectionKey(entry) === dragging.id)
      : -1

  /**
   * A slot that would put the dragged item back where it already is.
   *
   * Both sides of the source are dead: dropping above it or below it leaves the
   * order untouched. Showing a line there promises a move that will not happen,
   * so the preview stays quiet.
   */
  function isDeadSlot(ref: GapRef, node: SectionNode | null): boolean {
    if (ref.list === SECTION_LIST) {
      return (
        draggedSectionOrder >= 0 &&
        (ref.gap === draggedSectionOrder || ref.gap === draggedSectionOrder + 1)
      )
    }
    if (dragging?.kind !== 'session' || node === null) return false

    const ids = orderedSessionIds(node)
    const from = ids.indexOf(dragging.id)
    if (from === -1) return false

    const to = flatIndexAt(node, ref.list, ref.gap)
    return to === from || to === from + 1
  }

  /** True when `ref` is the slot the pointer is over and the move means something. */
  function isGap(ref: GapRef, node: SectionNode | null = null): boolean {
    if (target === null || target.kind !== 'insert') return false
    if (target.list !== ref.list || target.gap !== ref.gap) return false
    return !isDeadSlot(ref, node)
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

  /**
   * Turns a slot into a position in the section's flat session list.
   *
   * A slot is "before child `gap`", so the flat index is the number of sessions
   * held by every child above it — a project contributes its whole run, which is
   * why a slot below a project lands right after that project's sessions.
   */
  function flatIndexAt(node: SectionNode, list: string, gap: number): number {
    if (list === sectionList(sectionKey(node))) {
      let index = 0
      for (const child of node.children.slice(0, gap)) {
        index += child.kind === 'project' ? child.sessions.length : 1
      }
      return index
    }

    // A slot inside one project: skip the children above it, then the rows
    // inside the project itself.
    let index = 0
    for (const child of node.children) {
      if (child.kind === 'project') {
        if (projectList(child.project.id) === list) return index + gap
        index += child.sessions.length
      } else {
        index += 1
      }
    }
    return index
  }

  /** Re-inserts a dragged session at a slot and pins the section order. */
  async function dropSessionAt(node: SectionNode, draggedId: string, slot: GapRef): Promise<void> {
    const ids = orderedSessionIds(node)
    const targetId = ids[flatIndexAt(node, slot.list, slot.gap)] ?? null
    if (targetId === draggedId) return

    const next = ids.filter((id) => id !== draggedId)
    if (targetId === null) next.push(draggedId)
    else {
      const index = next.indexOf(targetId)
      next.splice(index === -1 ? next.length : index, 0, draggedId)
    }

    await reorderSessions(next)
    await setSectionSort(node.id, 'manual')
  }

  /**
   * Reorders every section — built-ins included — through one rule.
   *
   * The rebuild lives in `moveSectionOrder` so it is testable; `null` means the
   * move cannot be expressed and nothing is written. A slot already encodes the
   * side, so the insertion is always "before the key at that slot".
   */
  function moveSection(draggedKey: string, targetKey: string | null): void {
    const order = moveSectionOrder(movableSections.map(sectionKey), draggedKey, targetKey)
    if (order !== null) void setSectionOrder(order)
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
          const list = sectionList(sectionKey(node))
          const order = node.kind === 'archived' ? -1 : movableIndex(node)
          const into = target !== null && target.kind === 'into' && target.list === list
          // A section being dragged fades where it currently sits, so the list
          // reads as "this one is moving" instead of two identical blocks.
          const isSource = dragging?.kind === 'section' && dragging.id === sectionKey(node)
          const gapShown = (ref: GapRef): boolean => isGap(ref, node)

          return (
            <Fragment key={node.id}>
              {order >= 0 && <InsertGap show={isGap({ list: SECTION_LIST, gap: order })} />}
              <div
                className={cn('mb-0.5 transition-opacity duration-150', isSource && 'opacity-40')}
              >
                <div
                  onDragOver={(event) => {
                    if (node.kind === 'archived' || dragging === null) return
                    event.preventDefault()
                    event.stopPropagation()
                    // A section drag reorders the sections themselves, so the
                    // pointer half picks the slot above or below this one; any
                    // other drag files the item inside the section.
                    if (dragging.kind === 'section') {
                      markInsert({
                        list: SECTION_LIST,
                        gap: order + (dropEdge(event) === 'after' ? 1 : 0),
                      })
                      return
                    }
                    markInto(list)
                  }}
                  onDragLeave={(event) => {
                    if (pointerLeft(event)) clearPreview()
                  }}
                  onDrop={(event) => {
                    if (node.kind === 'archived' || dragging === null) return
                    event.preventDefault()
                    event.stopPropagation()
                    const after = dropEdge(event) === 'after'
                    const dragged = readDrag(event)
                    endDrag()
                    if (dragged === null) return

                    if (dragged.kind === 'section') {
                      // The slot decides the side: `after` moves the section
                      // below this one, which is how the topmost section can
                      // finally move down.
                      const keys = movableSections.map(sectionKey)
                      const target = keys[order + (after ? 1 : 0)] ?? null
                      moveSection(dragged.id, target)
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
                    into && 'ring-1 ring-accent',
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
                </div>

                <Collapse open={!isCollapsed}>
                  <div className="pl-3">
                    {node.children.map((child, index) => {
                      const before: GapRef = { list, gap: index }
                      // The slot below a child belongs to the section list even
                      // when the child is a project, so the boundary between a
                      // block and the next row owns one line, not two.
                      const after: GapRef = { list, gap: index + 1 }
                      return (
                        <Fragment
                          key={child.kind === 'project' ? child.project.id : child.session.id}
                        >
                          <InsertGap show={gapShown(before)} />
                          {child.kind === 'project' ? (
                            <ProjectBlock
                              node={child}
                              collapsed={collapsed}
                              onToggle={toggle}
                              selectedSessionId={selectedSessionId}
                              busy={busy}
                              tail={after}
                              target={target}
                              dragging={dragging}
                              isGap={gapShown}
                              markInto={markInto}
                              markInsert={markInsert}
                              clearPreview={clearPreview}
                              beginDrag={beginDrag}
                              endDrag={endDrag}
                              readDrag={readDrag}
                              menuItems={() => projectMenu(child.project, child)}
                              onCreate={() => createIn(node.sectionId, child.project.id)}
                              onSelect={selectSession}
                              onPin={(session) =>
                                void setSessionPinned(session.id, !session.pinned)
                              }
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
                              onDropSessionAt={(draggedId, gap) =>
                                void dropSessionAt(node, draggedId, gap)
                              }
                            />
                          ) : (
                            <SessionRow
                              session={child.session}
                              active={child.session.id === selectedSessionId}
                              busy={busy}
                              sectionId={node.sectionId}
                              before={before}
                              after={after}
                              dragging={dragging}
                              markInsert={markInsert}
                              clearPreview={clearPreview}
                              onSelect={() => selectSession(child.session.id)}
                              onPin={() =>
                                void setSessionPinned(child.session.id, !child.session.pinned)
                              }
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
                              onDropSession={(draggedId, gap) =>
                                void dropSessionAt(node, draggedId, gap)
                              }
                            />
                          )}
                        </Fragment>
                      )
                    })}
                    <InsertGap show={gapShown({ list, gap: node.children.length })} />
                  </div>
                </Collapse>
              </div>
            </Fragment>
          )
        })}

        <InsertGap show={isGap({ list: SECTION_LIST, gap: movableSections.length })} />
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
  tail,
  target,
  dragging,
  isGap,
  markInto,
  markInsert,
  clearPreview,
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
  onDropSessionAt,
}: {
  node: ProjectNode
  collapsed: Record<string, boolean>
  onToggle: (key: string) => void
  selectedSessionId: string | null
  busy: boolean
  /** Slot right below the block, which belongs to the parent section list. */
  tail: GapRef
  target: DropTarget | null
  dragging: Dragged | null
  isGap: (ref: GapRef) => boolean
  markInto: (list: string) => void
  markInsert: (ref: GapRef) => void
  clearPreview: () => void
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
  onDropSessionAt: (draggedId: string, gap: GapRef) => void
}): React.JSX.Element {
  const key = `project-${node.project.id}`
  const isCollapsed = collapsed[key] === true
  const Chevron = isCollapsed ? ChevronRight : ChevronDown
  const list = projectList(node.project.id)
  const isSource = dragging?.kind === 'project' && dragging.id === node.project.id
  // A session already inside this project has nowhere to go, and a project
  // cannot be filed into itself: both would be dead drops, so no ring.
  const isOwnSession =
    dragging?.kind === 'session' && node.sessions.some((session) => session.id === dragging.id)
  // Only a session or a project can be filed here; the ring marks the project
  // itself, without also lighting up the section that contains it.
  const isTarget =
    target !== null && target.kind === 'into' && target.list === list && !isSource && !isOwnSession

  return (
    <div className={cn('mb-0.5 transition-opacity duration-150', isSource && 'opacity-40')}>
      <div
        onDragOver={(event) => {
          if (dragging === null) return
          // A project cannot hold a section: drop the preview instead of
          // leaving the last slot line stranded next to the pointer.
          if (dragging.kind === 'section') {
            clearPreview()
            return
          }
          event.preventDefault()
          event.stopPropagation()
          markInto(list)
        }}
        onDragLeave={(event) => {
          if (pointerLeft(event)) clearPreview()
        }}
        onDrop={(event) => {
          if (dragging === null || dragging.kind === 'section') return
          event.preventDefault()
          event.stopPropagation()
          const dragged = readDrag(event)
          clearPreview()
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
            node.sessions.map((session, index) => {
              const before: GapRef = { list, gap: index }
              // The slot below the last row is the one after the whole block,
              // so the boundary owns a single line instead of two.
              const after: GapRef =
                index === node.sessions.length - 1 ? tail : { list, gap: index + 1 }
              return (
                <Fragment key={session.id}>
                  <InsertGap show={isGap(before)} />
                  <SessionRow
                    session={session}
                    active={session.id === selectedSessionId}
                    busy={busy}
                    sectionId={node.project.sectionId}
                    before={before}
                    after={after}
                    dragging={dragging}
                    markInsert={markInsert}
                    clearPreview={clearPreview}
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
                    onDropSession={onDropSessionAt}
                  />
                </Fragment>
              )
            })
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
  before,
  after,
  dragging,
  markInsert,
  clearPreview,
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
  /** Insertion slots on either side; the row never draws the line itself. */
  before: GapRef
  after: GapRef
  dragging: Dragged | null
  markInsert: (ref: GapRef) => void
  clearPreview: () => void
  onSelect: () => void
  onPin: () => void
  onArchive: () => void
  onDelete: () => void
  onDragStart: (event: React.DragEvent) => void
  onDragEnd: () => void
  readDrag: (event: React.DragEvent) => Dragged | null
  onDropSession: (draggedId: string, gap: GapRef) => void
}): React.JSX.Element {
  const running = useChatStore((state) => state.chats[session.id]?.running === true)

  /** Half of the row the pointer is over picks the slot above or below. */
  function slotAt(event: React.DragEvent<HTMLElement>): GapRef {
    return dropEdge(event) === 'before' ? before : after
  }

  const isSource = dragging?.kind === 'session' && dragging.id === session.id

  return (
    <div
      className={cn(
        'group/row relative rounded-md transition-opacity duration-150',
        isSource && 'opacity-40',
      )}
      onDragOver={(event) => {
        if (dragging === null || dragging.kind !== 'session') return
        if (dragging.id === session.id) {
          clearPreview()
          return
        }
        event.preventDefault()
        event.stopPropagation()
        markInsert(slotAt(event))
      }}
      onDragLeave={(event) => {
        if (pointerLeft(event)) clearPreview()
      }}
      onDrop={(event) => {
        if (dragging === null || dragging.kind !== 'session') return
        event.preventDefault()
        event.stopPropagation()
        const slot = slotAt(event)
        const dragged = readDrag(event)
        clearPreview()
        if (dragged !== null && dragged.kind === 'session') onDropSession(dragged.id, slot)
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
