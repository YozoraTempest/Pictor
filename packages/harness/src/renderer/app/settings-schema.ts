import type { GroupingMode, SectionSort } from '../features/sessions/grouping.js'

/**
 * The renderer's settings, in one table.
 *
 * Reading a setting used to mean re-deriving its type, its default and its
 * legacy spelling at every call site. Declaring them here keeps those three
 * facts next to each other, so a key is renamed or a default changes in one
 * place, and the parsers can be tested without a store.
 */
export const SETTING_KEYS = {
  /** How sessions are shared between sections. */
  grouping: 'sessions.grouping',
  /** Section order, built-ins included (see `sectionKey`). */
  sectionOrder: 'sessions.sectionOrder',
  /** Per-section manual sort, stored as `sessions.sort.<key>`. */
  sortPrefix: 'sessions.sort.',
  /** Superseded by `sessions.grouping`; still read so old installs keep working. */
  legacyGroupingExclusive: 'sessions.groupingExclusive',
} as const

export const GROUPING_MODES: readonly GroupingMode[] = ['overlap', 'pinned', 'basic', 'exclusive']

/** What the sidebar shows before the user has chosen anything. */
export const GROUPING_DEFAULT: GroupingMode = 'overlap'

function isGroupingMode(value: unknown): value is GroupingMode {
  return typeof value === 'string' && GROUPING_MODES.includes(value as GroupingMode)
}

/**
 * The grouping mode, falling back to the old pinned-only flag.
 *
 * The legacy flag came first and only knew "pinned on/off", so it maps onto
 * `pinned` rather than onto the current default.
 */
export function readGroupingMode(settings: Record<string, unknown>): GroupingMode {
  const value = settings[SETTING_KEYS.grouping]
  if (isGroupingMode(value)) return value

  return settings[SETTING_KEYS.legacyGroupingExclusive] === true ? 'pinned' : GROUPING_DEFAULT
}

/** Section order; any non-string entry is dropped rather than trusted. */
export function readSectionOrder(settings: Record<string, unknown>): string[] {
  const value = settings[SETTING_KEYS.sectionOrder]
  if (!Array.isArray(value)) return []

  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
}

/**
 * Per-section sort preferences.
 *
 * `manual` must survive a reload: dragging a session inside a section stores the
 * new order in `position` and switches that section to manual, so dropping it
 * here would silently undo the drag on the next launch.
 */
export function readSorts(settings: Record<string, unknown>): Record<string, SectionSort> {
  const sorts: Record<string, SectionSort> = {}

  for (const [key, value] of Object.entries(settings)) {
    if (!key.startsWith(SETTING_KEYS.sortPrefix)) continue
    if (value !== 'created' && value !== 'updated' && value !== 'manual') continue
    sorts[key.slice(SETTING_KEYS.sortPrefix.length)] = value
  }

  return sorts
}

/** Key a section's sort preference is stored under. */
export function sortKey(section: string): string {
  return `${SETTING_KEYS.sortPrefix}${section}`
}
