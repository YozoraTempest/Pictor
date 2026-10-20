import type { Project, Section, Session } from '@pictor/shared'

/** How sessions inside a section are ordered. */
export type SectionSort = 'created' | 'updated'

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
  /** When true a pinned session only shows up in the pinned section. */
  exclusive: boolean
  /** Sort preference per section id (built-in ids and custom section ids). */
  sorts: Record<string, SectionSort>
  now?: number
}

export const PINNED_ID = 'pinned'
export const PROJECTS_ID = 'projects'
export const RECENT_ID = 'recent'
export const ARCHIVED_ID = 'archived'

const DAY = 86_400_000

const RECENT_BUCKETS: Array<{ id: string; title: string }> = [
  { id: 'today', title: '今天' },
  { id: 'yesterday', title: '昨天' },
  { id: 'week', title: '最近 7 天' },
  { id: 'older', title: '更早' },
]

function sortSessions(sessions: Session[], sort: SectionSort): Session[] {
  const field = sort === 'created' ? 'createdAt' : 'updatedAt'
  return [...sessions].sort((a, b) => b[field] - a[field])
}

/** Folds a session list into project nodes plus leaves for sessions without one. */
function foldByProject(
  sessions: Session[],
  projects: Project[],
  sort: SectionSort,
  includeEmptyProjects: boolean,
): SectionChild[] {
  const byProject = new Map<string, Session[]>()
  const loose: Session[] = []

  for (const session of sessions) {
    const projectId = session.projectId
    if (projectId === null || !projects.some((project) => project.id === projectId)) {
      loose.push(session)
      continue
    }
    const bucket = byProject.get(projectId) ?? []
    bucket.push(session)
    byProject.set(projectId, bucket)
  }

  const children: SectionChild[] = []
  for (const project of projects) {
    const bucket = byProject.get(project.id)
    if (bucket === undefined) {
      if (includeEmptyProjects) children.push({ kind: 'project', project, sessions: [] })
      continue
    }
    children.push({ kind: 'project', project, sessions: sortSessions(bucket, sort) })
  }

  for (const session of sortSessions(loose, sort)) {
    children.push({ kind: 'session', session })
  }

  return children
}

function countChildren(children: SectionChild[]): number {
  return children.reduce(
    (total, child) => total + (child.kind === 'project' ? child.sessions.length : 1),
    0,
  )
}

function pickSort(sorts: Record<string, SectionSort>, key: string): SectionSort {
  return sorts[key] === 'created' ? 'created' : 'updated'
}

/**
 * Three-level sidebar model: section → project → session.
 *
 * `置顶` / `项目` / `最近` are always present so their menus and "+" actions are
 * reachable even when empty. Archived sessions never leak into other sections.
 */
export function groupSessions(input: GroupingInput): SectionNode[] {
  const { sessions, projects, sections, exclusive, sorts } = input

  const active = sessions.filter((session) => !session.archived)
  const archived = sessions.filter((session) => session.archived)
  const pinned = active.filter((session) => session.pinned)
  const rest = exclusive ? active.filter((session) => !session.pinned) : active

  const nodes: SectionNode[] = []

  const pinnedSort = pickSort(sorts, PINNED_ID)
  nodes.push({
    id: PINNED_ID,
    title: '置顶',
    kind: 'pinned',
    builtin: true,
    sectionId: null,
    sort: pinnedSort,
    children: foldByProject(pinned, projects, pinnedSort, false),
    count: pinned.length,
  })

  const projectsSort = pickSort(sorts, PROJECTS_ID)
  nodes.push({
    id: PROJECTS_ID,
    title: '项目',
    kind: 'projects',
    builtin: true,
    sectionId: null,
    sort: projectsSort,
    children: foldByProject(rest, projects, projectsSort, true),
    count: rest.length,
  })

  const recentSort = pickSort(sorts, RECENT_ID)
  nodes.push({
    id: RECENT_ID,
    title: '最近',
    kind: 'recent',
    builtin: true,
    sectionId: null,
    sort: recentSort,
    children: sortSessions(rest, recentSort).map((session) => ({ kind: 'session', session })),
    count: rest.length,
  })

  for (const section of [...sections].sort((a, b) => a.position - b.position)) {
    const tagged = rest.filter((session) => session.sectionIds.includes(section.id))
    const sort = pickSort(sorts, section.id)
    const children = foldByProject(tagged, projects, sort, false)

    nodes.push({
      id: `section:${section.id}`,
      title: section.name,
      kind: 'custom',
      builtin: false,
      sectionId: section.id,
      sort,
      children,
      count: countChildren(children),
    })
  }

  if (archived.length > 0) {
    const sort = pickSort(sorts, ARCHIVED_ID)
    nodes.push({
      id: ARCHIVED_ID,
      title: '已归档',
      kind: 'archived',
      builtin: false,
      sectionId: null,
      sort,
      children: sortSessions(archived, sort).map((session) => ({ kind: 'session', session })),
      count: archived.length,
    })
  }

  return nodes
}

/** Sessions reachable from a section, used by "archive this section". */
export function collectSectionSessionIds(node: SectionNode): string[] {
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

export { RECENT_BUCKETS, DAY }
