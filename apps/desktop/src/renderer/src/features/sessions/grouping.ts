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
}

export const PINNED_ID = 'pinned'
export const PROJECTS_ID = 'projects'
export const RECENT_ID = 'recent'
export const ARCHIVED_ID = 'archived'

/** 最近 and 已归档 always stay flat, even if a project is filed there. */
const FLAT_SECTIONS = new Set<SectionNode['kind']>(['recent', 'archived'])

function sortSessions(sessions: Session[], sort: SectionSort): Session[] {
  const field = sort === 'created' ? 'createdAt' : 'updatedAt'
  return [...sessions].sort((a, b) => b[field] - a[field])
}

function pickSort(sorts: Record<string, SectionSort>, key: string): SectionSort {
  return sorts[key] === 'created' ? 'created' : 'updated'
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
  const { sessions, projects, sections, exclusive, sorts } = input

  const active = sessions.filter((session) => !session.archived)
  const archived = sessions.filter((session) => session.archived)
  const pinned = active.filter((session) => session.pinned)
  const rest = exclusive ? active.filter((session) => !session.pinned) : active

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

  const nodes: SectionNode[] = [
    buildsSection(PINNED_ID, '置顶', 'pinned', PINNED_ID, pinned, active),
    buildsSection(PROJECTS_ID, '项目', 'projects', null, rest, rest),
    buildsSection(RECENT_ID, '最近', 'recent', null, rest, rest),
  ]

  for (const section of [...sections].sort((a, b) => a.position - b.position)) {
    const tagged = rest.filter((session) => session.sectionIds.includes(section.id))
    nodes.push(
      buildsSection(`section:${section.id}`, section.name, 'custom', section.id, tagged, active),
    )
  }

  if (archived.length > 0) {
    nodes.push(buildsSection(ARCHIVED_ID, '已归档', 'archived', null, archived, []))
  }

  return nodes
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
