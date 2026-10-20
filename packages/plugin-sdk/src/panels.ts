/**
 * Contribution point `panels`.
 *
 * A panel is one entry the workspace shows in its side panel: the browser, a
 * side chat, a plugin's own view. It belongs to plugins and to the workbench
 * itself — never to `tools`, which is the agent-facing capability surface: an
 * agent tool may open a panel, but a tool is not what a panel is made of.
 *
 * The payload stays data-only: a panel names a command to run when it opens, so
 * plugins never ship renderer code and the renderer never trusts a plugin with a
 * component. Built-in panels are declared through the same registry on the
 * renderer side, which keeps one list and one rendering path.
 */
export interface PanelContribution {
  /** Panel id, unique across the workbench. Dots are conventional: `browser.open`. */
  id: string
  title: string
  description?: string
  /** Lucide icon name. Unknown names fall back to a neutral icon. */
  icon?: string
  /** Command id executed when the panel is opened. */
  command: string
}

export interface PanelContributionFailure {
  id?: string
  reason: string
}

export class PanelContributionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PanelContributionError'
  }
}

const ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const ICON_PATTERN = /^[a-z][a-z0-9-]*$/
const MAX_TITLE = 60
const MAX_DESCRIPTION = 160

/**
 * Validates one panel contribution.
 *
 * Bad entries must fail alone: a malformed panel is dropped with a reason while
 * the plugin's other panels stay usable.
 */
export function parsePanelContribution(value: unknown): PanelContribution {
  if (typeof value !== 'object' || value === null) {
    throw new PanelContributionError('panel must be an object')
  }

  const record = value as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  if (id.length === 0) throw new PanelContributionError('panel.id is required')
  if (!ID_PATTERN.test(id)) throw new PanelContributionError(`panel.id is not a valid id: ${id}`)

  const title = typeof record.title === 'string' ? record.title.trim() : ''
  if (title.length === 0) throw new PanelContributionError(`panel.title is required: ${id}`)
  if (title.length > MAX_TITLE) {
    throw new PanelContributionError(`panel.title is longer than ${MAX_TITLE} characters: ${id}`)
  }

  const command = typeof record.command === 'string' ? record.command.trim() : ''
  if (command.length === 0) throw new PanelContributionError(`panel.command is required: ${id}`)
  if (!ID_PATTERN.test(command)) {
    throw new PanelContributionError(`panel.command is not a valid command id: ${id}`)
  }

  const description = record.description
  if (description !== undefined) {
    if (typeof description !== 'string') {
      throw new PanelContributionError(`panel.description must be a string: ${id}`)
    }
    if (description.length > MAX_DESCRIPTION) {
      throw new PanelContributionError(
        `panel.description is longer than ${MAX_DESCRIPTION} characters: ${id}`,
      )
    }
  }

  const icon = record.icon
  if (icon !== undefined) {
    if (typeof icon !== 'string' || !ICON_PATTERN.test(icon)) {
      throw new PanelContributionError(`panel.icon must be a kebab-case name: ${id}`)
    }
  }

  return {
    id,
    title,
    ...(description === undefined || description.length === 0 ? {} : { description }),
    ...(icon === undefined ? {} : { icon }),
    command,
  }
}

/**
 * Validates a batch, keeping the valid panels and reporting the rest.
 *
 * The first panel claiming an id wins; later duplicates are reported instead of
 * silently shadowing a panel the user already sees.
 */
export function parsePanelContributions(values: readonly unknown[]): {
  panels: PanelContribution[]
  failures: PanelContributionFailure[]
} {
  const panels: PanelContribution[] = []
  const failures: PanelContributionFailure[] = []
  const seen = new Set<string>()

  for (const value of values) {
    try {
      const panel = parsePanelContribution(value)
      if (seen.has(panel.id)) {
        failures.push({ id: panel.id, reason: `duplicate panel id: ${panel.id}` })
        continue
      }
      seen.add(panel.id)
      panels.push(panel)
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

  return { panels, failures }
}
