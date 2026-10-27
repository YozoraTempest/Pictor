/**
 * Slots: where a contribution sits, borrowed from dsh's vocabulary.
 *
 * A plugin used to register a `panels` entry and the app decided where rows went. That
 * works while there is one place to put things, and it stops working as soon as there
 * are several — a strip under the columns, a floating layer, a seat beside the title.
 * So the shape is dsh's instead: a contribution names a **slot**, and the window owns
 * what each slot means.
 *
 * What stayed Pictor's is the payload. A seat holds a `views` id, not a React component,
 * so the same rule as before holds: a plugin describes, the window draws.
 *
 * Every key below has a real place in the window. A slot nobody renders would be a
 * contribution that quietly does nothing, which is worse than refusing it — so `root`
 * is *not* here, and asking for it is an error rather than a silent no-op.
 */

export type SlotKind = 'single' | 'keyed' | 'list'

/**
 * Whether a seat is tied to a conversation.
 *
 * Informational for now: a `session` seat is only drawn while a conversation is
 * selected, and its view is handed that conversation's id. dsh expresses the same thing
 * with a responsive scope binding; this app passes the id and reads on demand.
 */
export type SlotScope = 'root' | 'session'

export interface SlotSpec {
  kind: SlotKind
  scope: SlotScope
  /** Where this seat is drawn, in words a plugin author can act on. */
  summary: string
}

/**
 * The slots a plugin may occupy.
 *
 * Keyed by the names dsh uses, because the point of borrowing them is that a person who
 * has written a dsh panel recognises these. `root` is deliberately absent: it is the
 * frame itself, and a second entry there would replace the application rather than add
 * to it.
 */
export const SLOT_SPECS = {
  /** The centre area. `conversation` is reserved for the transcript. */
  main: {
    kind: 'keyed',
    scope: 'session',
    summary: '中间那块：conversation 是会话，其余 key 是由插件提供的页面',
  },
  /** Top of the left column, above the conversation list (and above nothing on home). */
  sidebar: {
    kind: 'single',
    scope: 'root',
    summary: '左栏顶部的一条',
  },
  /** The right column. Occupying it replaces the panel list. */
  rightbar: {
    kind: 'single',
    scope: 'session',
    summary: '右栏整块（占用时替换面板列表）',
  },
  /** Full-width strip below the three columns, inside the workspace. */
  'shell.bottom': {
    kind: 'single',
    scope: 'root',
    summary: '三栏之下的通栏横条',
  },
  /** Floating layer above everything, click-through until an entry says otherwise. */
  'shell.overlay': {
    kind: 'list',
    scope: 'root',
    summary: '覆盖全窗口的浮动层（叠加，默认不挡点击）',
  },
  /** Title bar, left of the view's own tools. */
  'shell.leading': {
    kind: 'single',
    scope: 'root',
    summary: '标题栏左侧，视图自己的按钮之前',
  },
} as const satisfies Record<string, SlotSpec>

export type SlotKey = keyof typeof SLOT_SPECS

export const SLOT_KEYS = Object.keys(SLOT_SPECS) as SlotKey[]

export function isSlotKey(value: unknown): value is SlotKey {
  return typeof value === 'string' && value in SLOT_SPECS
}

/** The reserved key of `main`: the conversation itself, which no plugin may take. */
export const CONVERSATION_CELL = 'conversation'

/** One seat in the window, as a plugin asked for it. */
export interface SlotContribution {
  /** Which place in the window. */
  slot: SlotKey
  /**
   * Cell inside a `keyed` or `list` slot; absent for a `single` one.
   *
   * `main` is keyed because the centre shows one page at a time and the transcript is
   * one of them; a `list` slot stacks its entries.
   */
  key?: string
  title: string
  description?: string
  /** Lucide icon name, mapped by the window. */
  icon?: string
  /** The `views` contribution this seat draws. */
  view: string
}

export interface SlotContributionFailure {
  slot?: string
  key?: string
  reason: string
}

export class SlotContributionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SlotContributionError'
  }
}

const ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const ICON_PATTERN = /^[a-z][a-z0-9-]*$/
const MAX_TITLE = 60
const MAX_DESCRIPTION = 160

export const SLOT_LIMITS = {
  /** Entries a `list` slot draws before the rest are reported and dropped. */
  listEntries: 8,
} as const

function text(value: unknown, where: string, max: number): string {
  if (typeof value !== 'string') throw new SlotContributionError(`${where} must be a string`)
  if (value.length > max) {
    throw new SlotContributionError(`${where} is longer than ${String(max)} characters`)
  }
  return value
}

/**
 * Validates one seat.
 *
 * Strict about the key rules because they are the whole contract: a `single` slot with a
 * key would be two entries claiming one place, and a `keyed` slot without one would have
 * nowhere to put the second.
 */
export function parseSlotContribution(value: unknown): SlotContribution {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SlotContributionError('slot contribution must be an object')
  }
  const record = value as Record<string, unknown>

  const slot = record['slot']
  if (!isSlotKey(slot)) {
    throw new SlotContributionError(
      `slot must be one of ${SLOT_KEYS.join(', ')} — root is drawn by the window itself`,
    )
  }
  const spec = SLOT_SPECS[slot]

  const rawKey = record['key']
  let key: string | undefined
  if (spec.kind === 'single') {
    if (rawKey !== undefined) {
      throw new SlotContributionError(`${slot} holds one entry, so it takes no key: ${slot}`)
    }
  } else {
    const candidate = typeof rawKey === 'string' ? rawKey.trim() : ''
    if (candidate.length === 0) {
      throw new SlotContributionError(`${slot} needs a key: which cell of it is this?`)
    }
    if (!ID_PATTERN.test(candidate)) {
      throw new SlotContributionError(`${slot}.key is not a valid id: ${candidate}`)
    }
    if (slot === 'main' && candidate === CONVERSATION_CELL) {
      throw new SlotContributionError(
        `main.${CONVERSATION_CELL} is reserved for the transcript; pick another key`,
      )
    }
    key = candidate
  }

  const title = typeof record['title'] === 'string' ? record['title'].trim() : ''
  if (title.length === 0) throw new SlotContributionError(`slot.title is required: ${slot}`)
  if (title.length > MAX_TITLE) {
    throw new SlotContributionError(`slot.title is longer than ${String(MAX_TITLE)}: ${slot}`)
  }

  const view = typeof record['view'] === 'string' ? record['view'].trim() : ''
  if (view.length === 0) throw new SlotContributionError(`slot.view is required: ${slot}`)
  if (!ID_PATTERN.test(view)) {
    throw new SlotContributionError(`slot.view is not a valid view id: ${slot}`)
  }

  const description = record['description']
  let note: string | undefined
  if (description !== undefined) {
    note = text(description, 'slot.description', MAX_DESCRIPTION)
  }

  const icon = record['icon']
  if (icon !== undefined) {
    if (typeof icon !== 'string' || !ICON_PATTERN.test(icon)) {
      throw new SlotContributionError(`slot.icon must be a kebab-case name: ${slot}`)
    }
  }

  return {
    slot,
    ...(key === undefined ? {} : { key }),
    title,
    ...(note === undefined || note.length === 0 ? {} : { description: note }),
    ...(icon === undefined ? {} : { icon }),
    view,
  }
}

/** The cell a seat occupies; `single` slots use their own name. */
export function slotCellOf(contribution: SlotContribution): string {
  return contribution.key ?? contribution.slot
}

/** Validates a batch, keeping the valid seats and reporting the rest. */
export function parseSlotContributions(values: readonly unknown[]): {
  slots: SlotContribution[]
  failures: SlotContributionFailure[]
} {
  const slots: SlotContribution[] = []
  const failures: SlotContributionFailure[] = []
  const seen = new Map<string, SlotContribution>()

  for (const value of values) {
    try {
      const seat = parseSlotContribution(value)
      const cell = `${seat.slot}:${slotCellOf(seat)}`
      const previous = seen.get(cell)
      if (previous !== undefined) {
        failures.push({
          slot: seat.slot,
          key: seat.key ?? seat.slot,
          reason: `${cell} is already registered by another plugin`,
        })
        continue
      }
      seen.set(cell, seat)
      if (seat.slot === 'shell.overlay') {
        const drawn = slots.filter((entry) => entry.slot === 'shell.overlay').length
        if (drawn >= SLOT_LIMITS.listEntries) {
          failures.push({
            slot: seat.slot,
            key: seat.key ?? seat.slot,
            reason: `shell.overlay draws at most ${String(SLOT_LIMITS.listEntries)} entries`,
          })
          continue
        }
      }
      slots.push(seat)
    } catch (error) {
      failures.push({ reason: (error as Error).message })
    }
  }

  return { slots, failures }
}
