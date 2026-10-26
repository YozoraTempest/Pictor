import { isToolPattern, matchesTool } from './tool-pattern.js'

/**
 * Contribution point `toolHooks`.
 *
 * A guard decides whether a call may run; a hook reacts to how it ended. That split is
 * not a matter of taste — it is what the kernels can do. dsh's pre-execute decision is
 * `allow | deny | cancel | ask` and nothing else: there is no way to rewrite the
 * arguments a model sent, so a contract that promised it would be lying on the kernel
 * this app is built around. What both kernels *can* do is post-execution: dsh's
 * `tools/post-execute` accepts or replaces the result and can turn it into corrective
 * feedback, and Pi's `tool_result` may replace `content` and set `isError`. So a hook
 * sees a finished call and may shape what the model reads next.
 *
 * Two rules make that safe to reason about:
 *
 * - **Hooks fail open, guards fail closed.** A hook cannot grant or deny anything, so a
 *   throwing hook costs its own contribution and nothing else; a guard's failure is a
 *   refusal, because a policy that vanishes is a policy that was never enforced.
 * - **What a hook adds is attributed.** The text a hook attaches carries its id, so a
 *   reader of the transcript can tell the tool's own words from a plugin's. A hook that
 *   rewrites the result outright would make the transcript a claim about the tool, which
 *   it is not allowed to be.
 */

/** What one finished call looked like when the hooks saw it. */
export interface ToolHookContext {
  /** Tool name as the agent sees it, e.g. `bash` or `mcp__github__create_issue`. */
  tool: string
  /** The arguments the call was given. Untrusted: hooks must validate. */
  args: unknown
  /** Pictor conversation the call belongs to, when the kernel can name it. */
  session: string | null
  /** Whether the call reported success. */
  ok: boolean
  /**
   * The result text, clipped.
   *
   * Clipped because it crosses a socket and may be megabytes of terminal output or a
   * whole file; a hook that needs the whole thing should read what the tool touched
   * rather than the transcript copy of it.
   */
  output: string
}

/**
 * What a hook wants changed about the result.
 *
 * `note` is appended to the result the model reads, attributed to the hook. `fail` turns
 * the whole result into a failure that carries the hook's text — the call did happen, and
 * the model is told what the hook thinks it should do instead. Both may be absent, which
 * is a hook that only observes.
 */
export interface ToolHookVerdict {
  /** A sentence or two appended to the result, attributed to this hook. */
  note?: string
  /** Replaces the result with a failure carrying this text. First one wins. */
  fail?: string
}

export interface ToolHookContribution {
  id: string
  /** Shown in the plugin list; defaults to the id. */
  title?: string
  /**
   * Restrict the hook to these tools; omit to see every finished call.
   *
   * Same matching as everywhere else: exact names, or a prefix ending in `*`.
   */
  tools?: string[]
  after: (context: ToolHookContext) => ToolHookVerdict | void | Promise<ToolHookVerdict | void>
}

export interface ToolHookFailure {
  id?: string
  reason: string
}

export class ToolHookContributionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolHookContributionError'
  }
}

const ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const MAX_TITLE = 60
const MAX_NOTE = 4_000

/** How much of a result a hook is handed. */
export const HOOK_OUTPUT_LIMIT = 4_000

/** Validates one hook contribution; a bad entry fails alone. */
export function parseToolHookContribution(value: unknown): ToolHookContribution {
  if (typeof value !== 'object' || value === null) {
    throw new ToolHookContributionError('tool hook must be an object')
  }

  const record = value as Record<string, unknown>
  const id = typeof record['id'] === 'string' ? record['id'].trim() : ''
  if (id.length === 0) throw new ToolHookContributionError('tool hook id is required')
  if (!ID_PATTERN.test(id))
    throw new ToolHookContributionError(`tool hook id is not a valid id: ${id}`)

  if (typeof record['after'] !== 'function') {
    throw new ToolHookContributionError(`tool hook after must be a function: ${id}`)
  }

  const title = record['title']
  if (title !== undefined) {
    if (typeof title !== 'string') {
      throw new ToolHookContributionError(`tool hook title must be a string: ${id}`)
    }
    if (title.length > MAX_TITLE) {
      throw new ToolHookContributionError(
        `tool hook title is longer than ${MAX_TITLE} characters: ${id}`,
      )
    }
  }

  const tools = record['tools']
  if (tools !== undefined) {
    if (!Array.isArray(tools) || tools.length === 0) {
      throw new ToolHookContributionError(`tool hook tools must be a non-empty array: ${id}`)
    }
    for (const tool of tools) {
      if (typeof tool !== 'string' || !isToolPattern(tool)) {
        throw new ToolHookContributionError(`tool hook lists an invalid tool name: ${id}`)
      }
    }
  }

  return {
    id,
    ...(typeof title === 'string' && title.length > 0 ? { title } : {}),
    ...(tools === undefined ? {} : { tools: [...(tools as string[])] }),
    after: record['after'] as ToolHookContribution['after'],
  }
}

/** Validates a batch, keeping the valid hooks and reporting the rest. */
export function parseToolHookContributions(values: readonly unknown[]): {
  hooks: ToolHookContribution[]
  failures: ToolHookFailure[]
} {
  const hooks: ToolHookContribution[] = []
  const failures: ToolHookFailure[] = []
  const seen = new Set<string>()

  for (const value of values) {
    try {
      const hook = parseToolHookContribution(value)
      if (seen.has(hook.id)) {
        failures.push({ id: hook.id, reason: `duplicate tool hook id: ${hook.id}` })
        continue
      }
      seen.add(hook.id)
      hooks.push(hook)
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

  return { hooks, failures }
}

export interface ToolHookOutcome {
  /** Text to append to the result, each line already attributed to its hook. */
  note?: string
  /** A failure to replace the result with, attributed to the hook that asked for it. */
  fail?: string
  /** Hooks that threw or answered nonsense; reported, never fatal. */
  failures: ToolHookFailure[]
}

/**
 * Trims a result down to what a hook is allowed to see.
 *
 * A single place, so the clipping a hook experiences is the same on both kernels.
 */
export function hookOutputOf(text: string): string {
  return text.length <= HOOK_OUTPUT_LIMIT
    ? text
    : `${text.slice(0, HOOK_OUTPUT_LIMIT)}\n…（已截断，共 ${String(text.length)} 字符）`
}

/**
 * Runs the hook chain over one finished call.
 *
 * Order is registration order. Every hook runs — one hook's note is not a reason to hide
 * another's — except that the first `fail` decides the outcome, because two different
 * replacement results have no sensible join. A hook that throws is recorded and skipped:
 * failing open is what keeps an observation from being able to break a conversation.
 */
export async function evaluateToolHooks(
  hooks: readonly ToolHookContribution[],
  context: ToolHookContext,
): Promise<ToolHookOutcome> {
  const notes: string[] = []
  const failures: ToolHookFailure[] = []
  let fail: string | undefined

  for (const hook of hooks) {
    if (
      hook.tools !== undefined &&
      !hook.tools.some((pattern) => matchesTool(pattern, context.tool))
    ) {
      continue
    }

    let verdict: ToolHookVerdict | void
    try {
      verdict = await hook.after({ ...context, output: hookOutputOf(context.output) })
    } catch (error) {
      failures.push({
        id: hook.id,
        reason: `tool hook ${hook.id} failed: ${(error as Error).message}`,
      })
      continue
    }

    if (verdict === undefined || verdict === null) continue

    const note = typeof verdict.note === 'string' ? verdict.note.trim() : ''
    if (note.length > 0) notes.push(attribute(hook.id, note))

    const said = typeof verdict.fail === 'string' ? verdict.fail.trim() : ''
    if (said.length > 0 && fail === undefined) fail = attribute(hook.id, said)
  }

  return {
    ...(notes.length === 0 ? {} : { note: notes.join('\n\n') }),
    ...(fail === undefined ? {} : { fail }),
    failures,
  }
}

/** Marks text as a hook's, so the transcript never reads as the tool's own words. */
function attribute(id: string, text: string): string {
  return `[${id}] ${text.length <= MAX_NOTE ? text : `${text.slice(0, MAX_NOTE)}…`}`
}
