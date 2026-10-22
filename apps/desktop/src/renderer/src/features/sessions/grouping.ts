import type { Project, Section, Session } from '@pictor/shared'

/** How sessions inside a section are ordered. */
export type SectionSort = 'created' | 'updated' | 'manual'

/**
 * How a session is presented across sections.
 *
 * - `overlap` — a session can show up in several sections at once.
 * - `pinned` — a pinned session leaves the other sections behind.
 * - `basic` — like `exclusive`, except 最近 keeps every session so the list can
 *   still be read as a timeline.
 * - `exclusive` — every session belongs to exactly one section.
 */
export type GroupingMode = 'overlap' | 'pinned' | 'basic' | 'exclusive'

export interface SessionLeaf {
  kind: 'session'
  session: Session
}

export interface ProjectNode {
  kind: 'project'
  project: Project
  sessions: Session[]
}

export type SectionChild = SessionLeaf | ProjectNode

export interface SectionNode {
  /** `pinned` / `projects` / `recent` for the built-ins, `section:<id>`, `archived`. */
  id: string
  title: string
  kind: 'pinned' | 'projects' | 'recent' | 'custom' | 'archived'
  builtin: boolean
  /** Set for custom sections. */
  sectionId: string | null
  sort: SectionSort
  children: SectionChild[]
  count: number
}

export interface GroupingInput {
  sessions: Session[]
  projects: Project[]
  sections: Section[]
  mode: GroupingMode
  /**
   * Section order, built-ins included. Keys are `pinned` / `projects` / `recent`
   * or a custom section id; anything missing falls back to the default order.
   */
  order?: string[]
  /** Sort preference per section id (built-in ids and custom section ids). */
  sorts: Record<string, SectionSort>
}

export const PINNED_ID = 'pinned'
export const PROJECTS_ID = 'projects'
export const RECENT_ID = 'recent'
export const ARCHIVED_ID = 'archived'

/** 最近 and 已归档 always stay flat, even if a project is filed there. */
const FLAT_SECTIONS = new Set<SectionNode['kind']>(['recent', 'archived'])

function sortSessions(sessions: Session[], sort: SectionSort): Session[] {
  if (sort === 'manual') {
    return [...sessions].sort((a, b) => a.position - b.position || b.updatedAt - a.updatedAt)
  }

  const field = sort === 'created' ? 'createdAt' : 'updatedAt'
  return [...sessions].sort((a, b) => b[field] - a[field])
}

function pickSort(sorts: Record<string, SectionSort>, key: string): SectionSort {
  const value = sorts[key]
  return value === 'created' || value === 'manual' ? value : 'updated'
}

function countChildren(children: SectionChild[]): number {
  return children.reduce(
    (total, child) => total + (child.kind === 'project' ? child.sessions.length : 1),
    0,
  )
}

/**
 * Three-level sidebar model: section → project → session.
 *
 * Only 项目 and 置顶 nest sessions under projects; every other section lists
 * sessions directly so scanning stays flat. A project is placed in a section by
 * `project.sectionId` (`null` meaning the built-in 项目 section).
 */
export function groupSessions(input: GroupingInput): SectionNode[] {
  const { sessions, projects, sections, mode, sorts } = input

  const active = sessions.filter((session) => !session.archived)
  const archived = sessions.filter((session) => session.archived)
  const orderedSections = [...sections].sort((a, b) => a.position - b.position)
  const projectSection = new Map(projects.map((project) => [project.id, project.sectionId]))

  /**
   * The one section a session belongs to in `exclusive` mode.
   *
   * Pinning wins over everything (the user asked for it explicitly), then the
   * section its project is filed under, then the first section it was tagged
   * with, then 项目 for project sessions and 最近 for the rest.
   */
  function homeOf(session: Session): string {
    if (session.pinned) return PINNED_ID

    if (session.projectId !== null) {
      const sectionId = projectSection.get(session.projectId) ?? null
      if (sectionId !== null) return `section:${sectionId}`
    }

    for (const section of orderedSections) {
      if (session.sectionIds.includes(section.id)) return `section:${section.id}`
    }

    return session.projectId === null ? RECENT_ID : PROJECTS_ID
  }

  const pinned = active.filter((session) => session.pinned)
  const rest = mode === 'overlap' ? active : active.filter((session) => !session.pinned)

  /** `exclusive` and `basic` assign every session to one owning section. */
  const assigned = mode === 'exclusive' || mode === 'basic'

  /** Sessions assigned to one section, used as both children and nesting pool. */
  function candidatesFor(key: string): Session[] {
    if (!assigned) return rest
    // 最近 is the timeline: in `basic` it keeps every conversation, so the user
    // can still read the list in time order while the other sections stay unique.
    if (mode === 'basic' && key === RECENT_ID) return active
    return active.filter((session) => homeOf(session) === key)
  }

  function buildsSection(
    id: string,
    title: string,
    kind: SectionNode['kind'],
    sectionId: string | null,
    candidates: Session[],
    projectPool: Session[],
  ): SectionNode {
    const sort = pickSort(sorts, id)
    const projectsInSection = FLAT_SECTIONS.has(kind)
      ? []
      : projects.filter((project) => (project.sectionId ?? null) === sectionId)
    const nested = projectsInSection.length > 0
    const knownProjects = new Set(projectsInSection.map((project) => project.id))

    const children: SectionChild[] = []

    for (const project of projectsInSection) {
      const own = projectPool.filter((session) => session.projectId === project.id)
      children.push({ kind: 'project', project, sessions: sortSessions(own, sort) })
    }

    for (const session of sortSessions(candidates, sort)) {
      if (nested && session.projectId !== null && knownProjects.has(session.projectId)) continue
      children.push({ kind: 'session', session })
    }

    return {
      id,
      title,
      kind,
      builtin: kind === 'pinned' || kind === 'projects' || kind === 'recent',
      sectionId,
      sort,
      children,
      count: nested ? countChildren(children) : candidates.length,
    }
  }

  const pinnedCandidates = assigned ? candidatesFor(PINNED_ID) : pinned
  const projectsCandidates = candidatesFor(PROJECTS_ID)
  const recentCandidates = candidatesFor(RECENT_ID)

  // A project nests only its own sessions, so its pool is the section's own
  // candidates. Outside `exclusive` a filed project still lists all its
  // sessions, which is why the pool there is every active conversation.
  const builtins: SectionNode[] = [
    buildsSection(PINNED_ID, '置顶', 'pinned', PINNED_ID, pinnedCandidates, active),
    buildsSection(
      PROJECTS_ID,
      '项目',
      'projects',
      null,
      projectsCandidates,
      assigned ? projectsCandidates : rest,
    ),
    buildsSection(
      RECENT_ID,
      '最近',
      'recent',
      null,
      recentCandidates,
      assigned ? recentCandidates : rest,
    ),
  ]

  const customs = orderedSections.map((section) => {
    const key = `${section.id}`
    const tagged = assigned
      ? candidatesFor(`section:${key}`)
      : rest.filter((session) => session.sectionIds.includes(section.id))

    return buildsSection(
      `section:${key}`,
      section.name,
      'custom',
      section.id,
      tagged,
      assigned ? tagged : active,
    )
  })

  // Movement is one logic for every section, built-ins included, so the order is
  // driven by `order`; sections it does not mention keep their default spot at
  // the end (built-ins first, then custom sections by position).
  const pending = new Map<string, SectionNode>()
  for (const node of [...builtins, ...customs]) pending.set(sectionKey(node), node)

  const nodes: SectionNode[] = []
  for (const key of input.order ?? []) {
    const node = pending.get(key)
    if (node === undefined) continue
    pending.delete(key)
    nodes.push(node)
  }
  for (const node of [...builtins, ...customs]) {
    if (pending.delete(sectionKey(node))) nodes.push(node)
  }

  if (archived.length > 0) {
    nodes.push(buildsSection(ARCHIVED_ID, '已归档', 'archived', null, archived, []))
  }

  return nodes
}

/** Key a section is stored under when the user reorders the sidebar. */
export function sectionKey(node: SectionNode): string {
  return node.kind === 'custom' ? (node.sectionId ?? '') : node.id
}

/**
 * Rebuilds a section order after a drag.
 *
 * Keys drive the order, never indexes: removing the dragged section first
 * shifts every index after it, which used to make a section dropped below its
 * target land back where it started — the topmost section could not move down
 * at all. `edge` says which side of the target wins.
 *
 * Returns `null` when the move cannot be expressed (unknown key, or a rebuild
 * that would drop or duplicate a key) so the caller writes nothing rather than
 * a partial order.
 */
export function moveSectionOrder(
  keys: string[],
  draggedKey: string,
  targetKey: string | null,
  edge: 'before' | 'after' = 'before',
): string[] | null {
  if (draggedKey === targetKey) return null
  if (!keys.includes(draggedKey)) return null
  if (targetKey !== null && !keys.includes(targetKey)) return null

  const order = keys.filter((key) => key !== draggedKey)
  if (targetKey === null) order.push(draggedKey)
  else order.splice(order.indexOf(targetKey) + (edge === 'after' ? 1 : 0), 0, draggedKey)

  const sameSet = order.length === keys.length && order.every((key) => keys.includes(key))
  return sameSet ? order : null
}

/** Sessions reachable from a section, used by "archive this section". */
export function collectSectionSessionIds(node: SectionNode): string[] {
  const ids = new Set<string>()
  for (const child of node.children) {
    if (child.kind === 'project') {
      for (const session of child.sessions) ids.add(session.id)
    } else {
      ids.add(child.session.id)
    }
  }
  return [...ids]
}
