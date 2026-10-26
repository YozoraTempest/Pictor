import { isToolPattern, matchesTool } from './tool-pattern.js'

/**
 * Contribution point `toolGuards`.
 *
 * A guard inspects an agent tool call before it runs and can deny it. Guards are
 * the seam the product promised: the built-in policy stays allow-all, and a
 * plugin decides where it wants to be stricter. Guards are data plus one pure
 * function — they never receive the renderer, the filesystem or the key.
 *
 * `tools` here is the agent-facing capability surface (bash, write, edit…),
 * which is exactly what a guard is allowed to police.
 */
export type ToolGuardDecision = { decision: 'allow' } | { decision: 'deny'; reason: string }

export interface ToolGuardContext {
  /** Tool name as the agent sees it, e.g. `bash`. */
  tool: string
  /** Raw arguments the agent passed. Untrusted: guards must validate. */
  args: unknown
}

export interface ToolGuardContribution {
  id: string
  /** Shown in the plugin list; defaults to the id. */
  title?: string
  /**
   * Restrict the guard to these tools; omit to see every call.
   *
   * Exact names, or a prefix ending in `*` for a namespace a plugin cannot enumerate
   * (`mcp__github__*`). See `matchesTool`.
   */
  tools?: string[]
  decide: (context: ToolGuardContext) => ToolGuardDecision | Promise<ToolGuardDecision>
}

export interface ToolGuardFailure {
  id?: string
  reason: string
}

export class ToolGuardContributionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolGuardContributionError'
  }
}

const ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const MAX_TITLE = 60

/** Validates one guard contribution at the plugin boundary. */
export function parseToolGuardContribution(value: unknown): ToolGuardContribution {
  if (typeof value !== 'object' || value === null) {
    throw new ToolGuardContributionError('tool guard must be an object')
  }

  const record = value as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  if (id.length === 0) throw new ToolGuardContributionError('tool guard id is required')
  if (!ID_PATTERN.test(id)) {
    throw new ToolGuardContributionError(`tool guard id is not a valid id: ${id}`)
  }

  if (typeof record.decide !== 'function') {
    throw new ToolGuardContributionError(`tool guard decide must be a function: ${id}`)
  }

  const title = record.title
  if (title !== undefined) {
    if (typeof title !== 'string') {
      throw new ToolGuardContributionError(`tool guard title must be a string: ${id}`)
    }
    if (title.length > MAX_TITLE) {
      throw new ToolGuardContributionError(
        `tool guard title is longer than ${MAX_TITLE} characters: ${id}`,
      )
    }
  }

  const tools = record.tools
  if (tools !== undefined) {
    if (!Array.isArray(tools) || tools.length === 0) {
      throw new ToolGuardContributionError(`tool guard tools must be a non-empty array: ${id}`)
    }
    for (const tool of tools) {
      if (typeof tool !== 'string' || !isToolPattern(tool)) {
        throw new ToolGuardContributionError(`tool guard lists an invalid tool name: ${id}`)
      }
    }
  }

  return {
    id,
    ...(typeof title === 'string' && title.length > 0 ? { title } : {}),
    ...(tools === undefined ? {} : { tools: [...(tools as string[])] }),
    decide: record.decide as ToolGuardContribution['decide'],
  }
}

/**
 * Validates a batch, keeping the valid guards and reporting the rest.
 *
 * The first guard claiming an id wins, matching the panel registry: a plugin
 * cannot silently replace another plugin's guard.
 */
export function parseToolGuardContributions(values: readonly unknown[]): {
  guards: ToolGuardContribution[]
  failures: ToolGuardFailure[]
} {
  const guards: ToolGuardContribution[] = []
  const failures: ToolGuardFailure[] = []
  const seen = new Set<string>()

  for (const value of values) {
    try {
      const guard = parseToolGuardContribution(value)
      if (seen.has(guard.id)) {
        failures.push({ id: guard.id, reason: `duplicate tool guard id: ${guard.id}` })
        continue
      }
      seen.add(guard.id)
      guards.push(guard)
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

  return { guards, failures }
}

export interface ToolGuardVerdict {
  blocked: boolean
  /** Present when blocked: the first guard's reason. */
  reason?: string
  /** Guard that denied, for logs and the transcript row. */
  guard?: string
}

/**
 * Runs the guard chain.
 *
 * Order is registration order and the first deny wins — a later guard must not
 * be able to un-block what an earlier one refused. A guard that throws is
 * treated as a deny: failing closed is the only safe default for a policy hook.
 */
export async function evaluateToolGuards(
  guards: readonly ToolGuardContribution[],
  context: ToolGuardContext,
): Promise<ToolGuardVerdict> {
  for (const guard of guards) {
    if (
      guard.tools !== undefined &&
      !guard.tools.some((pattern) => matchesTool(pattern, context.tool))
    ) {
      continue
    }

    let decision: ToolGuardDecision
    try {
      decision = await guard.decide(context)
    } catch (error) {
      return {
        blocked: true,
        reason: `tool guard ${guard.id} failed: ${(error as Error).message}`,
        guard: guard.id,
      }
    }

    if (decision.decision === 'deny') {
      return { blocked: true, reason: decision.reason, guard: guard.id }
    }
  }

  return { blocked: false }
}
