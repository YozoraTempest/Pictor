/**
 * A conversation's skill catalog, as the runtime reports it.
 *
 * Skills are instructions on disk that a model loads on demand; the catalog is
 * the list of names and one-line descriptions a reader — or the model — chooses
 * from. The runtime resolves it per session, because a session's working
 * directory and preset decide which roots are scanned.
 */
export interface CatalogSkill {
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

/** Where one skill's file comes from, which decides where it can be switched off. */
export type SkillOrigin = 'plugin' | 'library' | 'filesystem' | 'project'

/** One row of the settings list: the catalog entry plus what Pictor knows. */
export interface SkillEntry extends CatalogSkill {
  origin: SkillOrigin
  /** `false` for a skill Pictor switched off; it is not in the runtime catalog. */
  enabled: boolean
  /** Plugin id that contributed it, when `origin` is `plugin`. */
  source: string | null
}

/**
 * What Pictor knows about its own skill root.
 *
 * The renderer never reads the disk, so the main process hands over the parts of
 * the picture the runtime cannot report: which entries Pictor wrote, which ones
 * it switched off, and where its root is.
 */
export interface SkillLibraryView {
  /** Absolute root Pictor writes into; the runtime scans it as the user root. */
  root: string | null
  /** Skills Pictor wrote, by name. */
  managed: ReadonlyMap<string, { origin: 'plugin' | 'library'; source: string | null }>
  /** Managed skills that are currently stashed, with what they said about themselves. */
  stashed: readonly {
    name: string
    description: string
    whenToUse: string | null
    source: string | null
  }[]
  /** External skills the user switched off, with the snapshot taken then. */
  disabled: readonly {
    name: string
    description: string
    whenToUse: string | null
    path: string | null
    origin: SkillOrigin
  }[]
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
export function parseSkills(value: unknown): CatalogSkill[] {
  const list = (value as { skills?: unknown } | null)?.skills
  if (!Array.isArray(list)) throw new Error('skills: 运行时没有返回技能列表')

  const entries = list.flatMap((item): CatalogSkill[] => {
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

/** Whether a path sits inside one of the project's own skill roots. */
function isProjectPath(path: string | null, projectRoot: string | null): boolean {
  if (path === null || projectRoot === null) return false
  const base = projectRoot.endsWith('/') ? projectRoot : `${projectRoot}/`
  return path.startsWith(`${base}.dsh/skills/`) || path.startsWith(`${base}.agents/skills/`)
}

/**
 * Folds the runtime catalog and what Pictor knows into the rows settings shows.
 *
 * Three sources have to line up: the runtime only reports what it can load, so a
 * skill Pictor switched off is missing from the catalog and has to be added back
 * from Pictor's own records — otherwise the switch would be the only way to
 * reach a row that no longer exists.
 */
export function composeSkills(
  catalog: readonly CatalogSkill[],
  library: SkillLibraryView,
  projectRoot: string | null,
): SkillEntry[] {
  const rows = new Map<string, SkillEntry>()

  for (const skill of catalog) {
    const managed = library.managed.get(skill.name)
    const origin: SkillOrigin =
      managed?.origin ?? (isProjectPath(skill.path, projectRoot) ? 'project' : 'filesystem')
    rows.set(skill.name, {
      ...skill,
      origin,
      enabled: true,
      source: managed?.source ?? null,
    })
  }

  for (const skill of library.stashed) {
    if (rows.has(skill.name)) continue
    rows.set(skill.name, {
      name: skill.name,
      description: skill.description,
      whenToUse: skill.whenToUse,
      path: null,
      modelInvocable: true,
      origin: skill.source === null ? 'library' : 'plugin',
      enabled: false,
      source: skill.source,
    })
  }

  for (const skill of library.disabled) {
    if (rows.has(skill.name)) continue
    rows.set(skill.name, {
      name: skill.name,
      description: skill.description,
      whenToUse: skill.whenToUse,
      path: skill.path,
      modelInvocable: true,
      origin: skill.origin,
      enabled: false,
      source: null,
    })
  }

  return [...rows.values()].sort((left, right) => left.name.localeCompare(right.name))
}
