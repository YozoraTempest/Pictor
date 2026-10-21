/**
 * Contribution point `toolViews`.
 *
 * A tool view is presentation data for one agent tool: the name the transcript
 * prints and the mark it draws next to it. It intentionally carries no rendering
 * code — the renderer owns the components, a plugin only says how its tool should
 * read.
 *
 * This is presentation, not capability: `tools` decides what the agent can call,
 * `toolGuards` decides whether a call may run, and `toolViews` only decides how a
 * finished call looks.
 */
export interface ToolViewContribution {
  /** Contribution id, unique across the workbench. Dots are conventional: `web.fetch`. */
  id: string
  /** Tool names this view applies to. */
  tools: string[]
  /** Display name; defaults to the built-in presenter's label. */
  label?: string
  /** Lucide icon name. Unknown names fall back to a neutral icon. */
  icon?: string
}

export interface ToolViewContributionFailure {
  id?: string
  reason: string
}

export class ToolViewContributionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolViewContributionError'
  }
}

const ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const TOOL_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const ICON_PATTERN = /^[a-z][a-z0-9-]*$/
const MAX_LABEL = 24
const MAX_TOOLS = 32

/** Validates one tool view; a bad entry fails alone. */
export function parseToolViewContribution(value: unknown): ToolViewContribution {
  if (typeof value !== 'object' || value === null) {
    throw new ToolViewContributionError('tool view must be an object')
  }

  const record = value as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  if (id.length === 0) throw new ToolViewContributionError('toolView.id is required')
  if (!ID_PATTERN.test(id)) {
    throw new ToolViewContributionError(`toolView.id is not a valid id: ${id}`)
  }

  if (!Array.isArray(record.tools)) {
    throw new ToolViewContributionError(`toolView.tools must be an array: ${id}`)
  }
  if (record.tools.length === 0) {
    throw new ToolViewContributionError(`toolView.tools is empty: ${id}`)
  }
  if (record.tools.length > MAX_TOOLS) {
    throw new ToolViewContributionError(`toolView.tools has more than ${MAX_TOOLS} entries: ${id}`)
  }

  const tools = record.tools.map((tool) => {
    const name = typeof tool === 'string' ? tool.trim() : ''
    if (!TOOL_PATTERN.test(name)) {
      throw new ToolViewContributionError(`toolView.tools has an invalid tool name: ${id}`)
    }
    return name
  })

  const label = record.label
  if (label !== undefined) {
    if (typeof label !== 'string') {
      throw new ToolViewContributionError(`toolView.label must be a string: ${id}`)
    }
    if (label.trim().length === 0) {
      throw new ToolViewContributionError(`toolView.label is empty: ${id}`)
    }
    if (label.length > MAX_LABEL) {
      throw new ToolViewContributionError(
        `toolView.label is longer than ${MAX_LABEL} characters: ${id}`,
      )
    }
  }

  const icon = record.icon
  if (icon !== undefined) {
    if (typeof icon !== 'string' || !ICON_PATTERN.test(icon)) {
      throw new ToolViewContributionError(`toolView.icon must be a kebab-case name: ${id}`)
    }
  }

  return {
    id,
    tools,
    ...(label === undefined ? {} : { label: label.trim() }),
    ...(icon === undefined ? {} : { icon }),
  }
}

/**
 * Validates a batch, keeping the valid views and reporting the rest.
 *
 * The first view claiming a tool wins: a second plugin must not silently change
 * how someone else's tool reads.
 */
export function parseToolViewContributions(values: readonly unknown[]): {
  views: ToolViewContribution[]
  failures: ToolViewContributionFailure[]
} {
  const views: ToolViewContribution[] = []
  const failures: ToolViewContributionFailure[] = []
  const seenIds = new Set<string>()
  const seenTools = new Set<string>()

  for (const value of values) {
    try {
      const view = parseToolViewContribution(value)
      if (seenIds.has(view.id)) {
        failures.push({ id: view.id, reason: `duplicate tool view id: ${view.id}` })
        continue
      }

      const clash = view.tools.find((tool) => seenTools.has(tool))
      if (clash !== undefined) {
        failures.push({ id: view.id, reason: `tool already has a view: ${clash}` })
        continue
      }

      seenIds.add(view.id)
      for (const tool of view.tools) seenTools.add(tool)
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
