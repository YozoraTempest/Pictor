/**
 * A conversation's skill catalog, as the runtime reports it.
 *
 * Skills are instructions on disk that a model loads on demand; the catalog is
 * the list of names and one-line descriptions a reader — or the model — chooses
 * from. The runtime resolves it per session, because a session's working
 * directory and preset decide which roots are scanned.
 */
export interface SkillEntry {
  /** Kebab-case identifier; `/name` invokes it and the `skill` tool loads it. */
  name: string
  /** One line the catalog shows instead of the body. */
  description: string
  /** Extra routing guidance the author wrote, when the file carried any. */
  whenToUse: string | null
  /** Absolute instruction file, for opening it in the file manager. */
  path: string | null
  /** Whether the same skill is also offered to the model. */
  modelInvocable: boolean
}

/**
 * Reads `skills/list`'s answer.
 *
 * The runtime is the only writer of this shape, so a payload that is not a list
 * of entries means the contract moved: that must surface as an error rather than
 * as an empty catalog, which would read "you have no skills". A single entry with
 * a field of the wrong type is dropped instead — one broken file should not hide
 * the rest of the catalog.
 */
export function parseSkills(value: unknown): SkillEntry[] {
  const list = (value as { skills?: unknown } | null)?.skills
  if (!Array.isArray(list)) throw new Error('skills: 运行时没有返回技能列表')

  const entries = list.flatMap((item): SkillEntry[] => {
    const entry = item as Record<string, unknown> | null
    if (typeof entry !== 'object' || entry === null) return []
    const name = entry['name']
    const description = entry['description']
    const modelInvocable = entry['modelInvocable']
    if (typeof name !== 'string' || name.length === 0) return []
    if (typeof description !== 'string' || typeof modelInvocable !== 'boolean') return []
    const whenToUse = entry['whenToUse']
    const path = entry['path']
    return [
      {
        name,
        description,
        modelInvocable,
        whenToUse: typeof whenToUse === 'string' && whenToUse.length > 0 ? whenToUse : null,
        path: typeof path === 'string' && path.length > 0 ? path : null,
      },
    ]
  })

  // Every entry was rejected while the runtime reported some: the fields moved.
  if (entries.length === 0 && list.length > 0) {
    throw new Error('skills: 运行时返回的技能条目缺少必要字段')
  }
  return entries.sort((left, right) => left.name.localeCompare(right.name))
}
