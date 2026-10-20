import type { Project, Section, Session, SessionGrouping } from '@pictor/shared'

export type SessionGroupKind = 'pinned' | 'project' | 'section' | 'recent' | 'unfiled'

export interface SessionGroup {
  /** Stable key for React lists; unique within one grouping result. */
  id: string
  title: string
  kind: SessionGroupKind
  sessions: Session[]
}

export interface GroupingInput {
  sessions: Session[]
  projects: Project[]
  sections: Section[]
  grouping: SessionGrouping
  /**
   * When `true` a session is shown in exactly one group. Pinned sessions then
   * only appear in the pinned group, and a session with several sections only
   * appears under the first one.
   */
  exclusive: boolean
  /** Injectable clock so the "recent" buckets stay testable. */
  now?: number
}

const DAY = 86_400_000

const RECENT_BUCKETS: Array<{ id: string; title: string; within: (age: number) => boolean }> = [
  { id: 'today', title: '今天', within: (age) => age < DAY },
  { id: 'yesterday', title: '昨天', within: (age) => age < 2 * DAY },
  { id: 'week', title: '最近 7 天', within: (age) => age < 7 * DAY },
  { id: 'older', title: '更早', within: () => true },
]

function byRecency(a: Session, b: Session): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  return b.updatedAt - a.updatedAt
}

function bucketOf(timestamp: number, now: number): string {
  const age = Math.max(0, now - timestamp)
  return RECENT_BUCKETS.find((bucket) => bucket.within(age))?.id ?? 'older'
}

/**
 * Turns a flat session list into the groups the sidebar renders.
 *
 * Pinned sessions always come first. In exclusive mode they are removed from
 * the remaining groups; otherwise they are also listed where they belong.
 */
export function groupSessions(input: GroupingInput): SessionGroup[] {
  const { sessions, projects, sections, grouping, exclusive } = input
  const now = input.now ?? Date.now()

  const sorted = [...sessions].sort(byRecency)
  const pinned = sorted.filter((session) => session.pinned)
  const rest = exclusive ? sorted.filter((session) => !session.pinned) : sorted

  const groups: SessionGroup[] = []
  if (pinned.length > 0) {
    groups.push({ id: 'pinned', title: '置顶', kind: 'pinned', sessions: pinned })
  }

  if (grouping === 'project') {
    const byProject = new Map<string, Session[]>()
    const unfiled: Session[] = []

    for (const session of rest) {
      const projectId = session.projectId
      if (projectId === null || !projects.some((project) => project.id === projectId)) {
        unfiled.push(session)
        continue
      }
      const bucket = byProject.get(projectId) ?? []
      bucket.push(session)
      byProject.set(projectId, bucket)
    }

    for (const project of projects) {
      const bucket = byProject.get(project.id)
      if (bucket === undefined) continue
      groups.push({
        id: `project-${project.id}`,
        title: project.name,
        kind: 'project',
        sessions: bucket,
      })
    }

    if (unfiled.length > 0) {
      groups.push({ id: 'unfiled', title: '未归属项目', kind: 'unfiled', sessions: unfiled })
    }

    return groups
  }

  if (grouping === 'section') {
    const bySection = new Map<string, Session[]>()
    const unfiled: Session[] = []
    const orderedSections = [...sections].sort((a, b) => a.position - b.position)

    for (const session of rest) {
      const known = orderedSections.filter((section) => session.sectionIds.includes(section.id))
      if (known.length === 0) {
        unfiled.push(session)
        continue
      }

      const targets = exclusive ? known.slice(0, 1) : known
      for (const section of targets) {
        const bucket = bySection.get(section.id) ?? []
        bucket.push(session)
        bySection.set(section.id, bucket)
      }
    }

    for (const section of orderedSections) {
      const bucket = bySection.get(section.id)
      if (bucket === undefined) continue
      groups.push({
        id: `section-${section.id}`,
        title: section.name,
        kind: 'section',
        sessions: bucket,
      })
    }

    if (unfiled.length > 0) {
      groups.push({ id: 'unfiled', title: '未归档', kind: 'unfiled', sessions: unfiled })
    }

    return groups
  }

  const byBucket = new Map<string, Session[]>()
  for (const session of rest) {
    const id = bucketOf(session.updatedAt, now)
    const bucket = byBucket.get(id) ?? []
    bucket.push(session)
    byBucket.set(id, bucket)
  }

  for (const bucket of RECENT_BUCKETS) {
    const bucketSessions = byBucket.get(bucket.id)
    if (bucketSessions === undefined) continue
    groups.push({
      id: `recent-${bucket.id}`,
      title: bucket.title,
      kind: 'recent',
      sessions: bucketSessions,
    })
  }

  return groups
}
