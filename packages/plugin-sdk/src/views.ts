/**
 * Contribution point `views`: what a plugin panel shows.
 *
 * The renderer draws these, not the plugin. A view is a **description** — headings, text,
 * lists, tables, code — validated block by block before anything is drawn. That is the
 * line this project drew when panels were first added ("plugins never ship renderer code
 * and the renderer never trusts a plugin with a component"), and it is the line that makes
 * a panel safe to open without loading a plugin's React into the window.
 *
 * The vocabulary is deliberately small. A plugin that needs something the blocks cannot
 * say is asking for a rendering engine, and the honest answer is that this is not one.
 */

export type ViewTone = 'neutral' | 'accent' | 'danger' | 'success'

/** One piece of a panel's content. */
export type ViewBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'text'; text: string }
  /** Text with markdown structure; rendered with the same renderer the transcript uses. */
  | { kind: 'markdown'; text: string }
  | { kind: 'list'; items: string[]; ordered?: boolean }
  | { kind: 'keyValue'; rows: { label: string; value: string }[] }
  | { kind: 'table'; columns: string[]; rows: string[][] }
  | { kind: 'code'; text: string; language?: string }
  | { kind: 'badge'; label: string; tone?: ViewTone }
  /**
   * The one block a person can press.
   *
   * `action` is an id the plugin's `onAction` recognises, not code: the click travels to
   * the main process — where the plugin already runs — and comes back as a new
   * description or nothing at all. That keeps the line the blocks draw: the window draws,
   * the plugin decides.
   */
  | { kind: 'button'; label: string; action: string; value?: string; tone?: ViewTone }
  | { kind: 'divider' }

/** One panel's content, as the plugin described it. */
export interface ViewSpec {
  blocks: ViewBlock[]
  /**
   * One line the plugin wants the reader to know — a timestamp, its own limits, where the
   * data came from. Drawn under the blocks, in the place limitations belong.
   */
  note?: string
}

/** What a view is handed when the window asks it for content. */
export interface ViewContext {
  /** The conversation the panel was opened over, when there is one. */
  sessionId: string | null
  /** Where this plugin may keep files of its own. */
  dataDirectory: string
  /** The plugin's own id, so a view can name itself in diagnostics. */
  pluginId: string
}

export interface ViewContribution {
  id: string
  title: string
  /** One line for the panel list; absent is fine. */
  description?: string
  /** Lucide icon name, mapped by the renderer. */
  icon?: string
  /**
   * Produce the current content.
   *
   * Called when the panel is opened and when the reader asks for a refresh — never on a
   * timer here: a view that needs polling can return a `note` saying when it was read, and
   * a plugin that must watch something can do that in its own process.
   */
  data: (context: ViewContext) => ViewSpec | Promise<ViewSpec>
  /**
   * Handles a press on one of this view's `button` blocks.
   *
   * Return a fresh spec to redraw, or nothing when the click changed nothing the panel
   * shows — the window then leaves the content alone rather than flashing it. Absent
   * means the view has no buttons; a button without a handler reports that instead of
   * doing nothing.
   */
  onAction?: (request: ViewActionRequest) => ViewSpec | void | Promise<ViewSpec | void>
}

/** One press, as the plugin receives it. */
export interface ViewActionRequest extends ViewContext {
  /** The `action` id from the button block. */
  action: string
  /** The button's `value`, when it carried one. */
  value?: string
}

export interface ViewContributionFailure {
  id?: string
  reason: string
}

export class ViewContributionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ViewContributionError'
  }
}

export class ViewSpecError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ViewSpecError'
  }
}

const ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const ICON_PATTERN = /^[a-z][a-z0-9-]*$/
const MAX_TITLE = 60
const MAX_DESCRIPTION = 160

/** Limits. A view is a panel, not a document: these keep one open cheap. */
export const VIEW_LIMITS = {
  blocks: 200,
  text: 20_000,
  listItems: 200,
  rows: 200,
  columns: 12,
  note: 400,
  /** A button's caption, and the value it carries back. */
  label: 60,
  action: 200,
} as const

const ACTION_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const TONES = new Set<ViewTone>(['neutral', 'accent', 'danger', 'success'])

function textOf(value: unknown, where: string, limit: number): string {
  if (typeof value !== 'string') throw new ViewSpecError(`${where} must be a string`)
  if (value.length > limit) {
    throw new ViewSpecError(`${where} is longer than ${String(limit)} characters`)
  }
  return value
}

function rowsOf(value: unknown, where: string): string[][] {
  if (!Array.isArray(value)) throw new ViewSpecError(`${where} must be an array`)
  if (value.length > VIEW_LIMITS.rows) {
    throw new ViewSpecError(`${where} has more than ${String(VIEW_LIMITS.rows)} rows`)
  }
  return value.map((row, index) => {
    if (!Array.isArray(row)) throw new ViewSpecError(`${where}[${String(index)}] must be an array`)
    if (row.length > VIEW_LIMITS.columns) {
      throw new ViewSpecError(`${where}[${String(index)}] has too many columns`)
    }
    return row.map((cell, column) =>
      textOf(cell, `${where}[${String(index)}][${String(column)}]`, VIEW_LIMITS.text),
    )
  })
}

/**
 * Validates one block.
 *
 * Strict on purpose: an unknown `kind` is a plugin asking for a renderer it does not have,
 * and drawing nothing would leave a panel that silently lost half its content.
 */
function parseBlock(value: unknown, index: number): ViewBlock {
  const where = `view.blocks[${String(index)}]`
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ViewSpecError(`${where} must be an object`)
  }
  const record = value as Record<string, unknown>
  const kind = typeof record['kind'] === 'string' ? record['kind'] : ''

  switch (kind) {
    case 'heading':
      return { kind, text: textOf(record['text'], `${where}.text`, VIEW_LIMITS.text) }
    case 'text':
      return { kind, text: textOf(record['text'], `${where}.text`, VIEW_LIMITS.text) }
    case 'markdown':
      return { kind, text: textOf(record['text'], `${where}.text`, VIEW_LIMITS.text) }
    case 'code':
      return {
        kind,
        text: textOf(record['text'], `${where}.text`, VIEW_LIMITS.text),
        ...(typeof record['language'] === 'string'
          ? { language: textOf(record['language'], `${where}.language`, 32) }
          : {}),
      }
    case 'badge': {
      const tone = record['tone']
      if (tone !== undefined && !TONES.has(tone as ViewTone)) {
        throw new ViewSpecError(`${where}.tone must be one of neutral, accent, danger, success`)
      }
      return {
        kind,
        label: textOf(record['label'], `${where}.label`, 120),
        ...(tone === undefined ? {} : { tone: tone as ViewTone }),
      }
    }
    case 'button': {
      const tone = record['tone']
      if (tone !== undefined && !TONES.has(tone as ViewTone)) {
        throw new ViewSpecError(`${where}.tone must be one of neutral, accent, danger, success`)
      }
      const action = textOf(record['action'], `${where}.action`, VIEW_LIMITS.action)
      if (!ACTION_PATTERN.test(action)) {
        throw new ViewSpecError(`${where}.action is not a valid action id: ${action}`)
      }
      const label = textOf(record['label'], `${where}.label`, VIEW_LIMITS.label)
      // An empty caption would be a button nobody can find but anybody can press.
      if (label.trim().length === 0) {
        throw new ViewSpecError(`${where}.label must not be empty`)
      }
      return {
        kind,
        action,
        label,
        ...(record['value'] === undefined
          ? {}
          : { value: textOf(record['value'], `${where}.value`, VIEW_LIMITS.action) }),
        ...(tone === undefined ? {} : { tone: tone as ViewTone }),
      }
    }
    case 'divider':
      return { kind }
    case 'list': {
      const items = record['items']
      if (!Array.isArray(items)) throw new ViewSpecError(`${where}.items must be an array`)
      if (items.length > VIEW_LIMITS.listItems) {
        throw new ViewSpecError(
          `${where}.items has more than ${String(VIEW_LIMITS.listItems)} entries`,
        )
      }
      const ordered = record['ordered']
      if (ordered !== undefined && typeof ordered !== 'boolean') {
        throw new ViewSpecError(`${where}.ordered must be a boolean`)
      }
      return {
        kind,
        items: items.map((item, at) =>
          textOf(item, `${where}.items[${String(at)}]`, VIEW_LIMITS.text),
        ),
        ...(ordered === undefined ? {} : { ordered }),
      }
    }
    case 'keyValue': {
      const rows = record['rows']
      if (!Array.isArray(rows)) throw new ViewSpecError(`${where}.rows must be an array`)
      if (rows.length > VIEW_LIMITS.rows) throw new ViewSpecError(`${where}.rows is too long`)
      return {
        kind,
        rows: rows.map((row, at) => {
          if (typeof row !== 'object' || row === null) {
            throw new ViewSpecError(`${where}.rows[${String(at)}] must be an object`)
          }
          const entry = row as Record<string, unknown>
          return {
            label: textOf(entry['label'], `${where}.rows[${String(at)}].label`, 120),
            value: textOf(entry['value'], `${where}.rows[${String(at)}].value`, VIEW_LIMITS.text),
          }
        }),
      }
    }
    case 'table': {
      const columns = record['columns']
      if (!Array.isArray(columns) || columns.length === 0) {
        throw new ViewSpecError(`${where}.columns must be a non-empty array`)
      }
      if (columns.length > VIEW_LIMITS.columns) {
        throw new ViewSpecError(
          `${where}.columns has more than ${String(VIEW_LIMITS.columns)} entries`,
        )
      }
      const rows = rowsOf(record['rows'], `${where}.rows`)
      const width = columns.length
      rows.forEach((row, at) => {
        if (row.length !== width) {
          throw new ViewSpecError(
            `${where}.rows[${String(at)}] has ${String(row.length)} cells, want ${String(width)}`,
          )
        }
      })
      return {
        kind,
        columns: columns.map((column, at) =>
          textOf(column, `${where}.columns[${String(at)}]`, 120),
        ),
        rows,
      }
    }
    default:
      throw new ViewSpecError(
        `${where}.kind is not one this window draws: ${kind.length === 0 ? '(missing)' : kind}`,
      )
  }
}

/**
 * Validates what a view's `data` returned.
 *
 * Every block is checked, and one bad block fails the whole view: a panel that dropped the
 * offending block would look like a plugin with less to say than it has.
 */
export function parseViewSpec(value: unknown): ViewSpec {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ViewSpecError('a view must be an object with blocks')
  }
  const record = value as Record<string, unknown>
  const blocks = record['blocks']
  if (!Array.isArray(blocks)) throw new ViewSpecError('view.blocks must be an array')
  if (blocks.length > VIEW_LIMITS.blocks) {
    throw new ViewSpecError(`view.blocks has more than ${String(VIEW_LIMITS.blocks)} entries`)
  }

  const note = record['note']
  return {
    blocks: blocks.map((block, index) => parseBlock(block, index)),
    ...(note === undefined ? {} : { note: textOf(note, 'view.note', VIEW_LIMITS.note) }),
  }
}

/** Validates one `views` contribution; a bad entry fails alone. */
export function parseViewContribution(value: unknown): ViewContribution {
  if (typeof value !== 'object' || value === null) {
    throw new ViewContributionError('view must be an object')
  }
  const record = value as Record<string, unknown>

  const id = typeof record['id'] === 'string' ? record['id'].trim() : ''
  if (id.length === 0) throw new ViewContributionError('view.id is required')
  if (!ID_PATTERN.test(id)) throw new ViewContributionError(`view.id is not a valid id: ${id}`)

  const title = typeof record['title'] === 'string' ? record['title'].trim() : ''
  if (title.length === 0) throw new ViewContributionError(`view.title is required: ${id}`)
  if (title.length > MAX_TITLE) {
    throw new ViewContributionError(
      `view.title is longer than ${String(MAX_TITLE)} characters: ${id}`,
    )
  }

  if (typeof record['data'] !== 'function') {
    throw new ViewContributionError(`view.data must be a function: ${id}`)
  }

  const description = record['description']
  if (description !== undefined) {
    if (typeof description !== 'string') {
      throw new ViewContributionError(`view.description must be a string: ${id}`)
    }
    if (description.length > MAX_DESCRIPTION) {
      throw new ViewContributionError(
        `view.description is longer than ${String(MAX_DESCRIPTION)}: ${id}`,
      )
    }
  }

  const onAction = record['onAction']
  if (onAction !== undefined && typeof onAction !== 'function') {
    throw new ViewContributionError(`view.onAction must be a function: ${id}`)
  }

  const icon = record['icon']
  if (icon !== undefined) {
    if (typeof icon !== 'string' || !ICON_PATTERN.test(icon)) {
      throw new ViewContributionError(`view.icon must be a kebab-case name: ${id}`)
    }
  }

  return {
    id,
    title,
    ...(description === undefined || description.length === 0 ? {} : { description }),
    ...(icon === undefined ? {} : { icon }),
    data: record['data'] as ViewContribution['data'],
    ...(onAction === undefined ? {} : { onAction: onAction as ViewContribution['onAction'] }),
  }
}

/** Validates a batch, keeping the valid views and reporting the rest. */
export function parseViewContributions(values: readonly unknown[]): {
  views: ViewContribution[]
  failures: ViewContributionFailure[]
} {
  const views: ViewContribution[] = []
  const failures: ViewContributionFailure[] = []
  const seen = new Set<string>()

  for (const value of values) {
    try {
      const view = parseViewContribution(value)
      if (seen.has(view.id)) {
        failures.push({ id: view.id, reason: `duplicate view id: ${view.id}` })
        continue
      }
      seen.add(view.id)
      views.push(view)
    } catch (error) {
      const id =
        typeof value === 'object' &&
        value !== null &&
        typeof (value as { id?: unknown }).id === 'string'
          ? (value as { id: string }).id
          : undefined
      failures.push({ ...(id === undefined ? {} : { id }), reason: (error as Error).message })
    }
  }

  return { views, failures }
}
