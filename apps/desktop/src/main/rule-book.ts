import type { ApprovalMode, ToolRule, ToolAskSource } from '@vulonlok/shared'
import { allowsTool, askVerdict, matchDenyRule, parseToolRules } from '@vulonlok/shared'

/** The part of the host core this needs: one settings key, read and written. */
export interface RuleStore {
  listSettings(): Promise<Record<string, unknown>>
  putSetting(key: string, value: unknown): Promise<void>
}

/** Settings key the list lives under. */
const KEY = 'permissions.rules'

/**
 * The live copy of the tool rules.
 *
 * Guards are built once, when the runtime is patched, but a rule must take effect
 * the moment it is saved. So the guard closes over this book and asks it per call
 * instead of capturing a snapshot; saving replaces the list in place and persists
 * it, and the next tool call already sees the new policy.
 */
export class RuleBook {
  readonly #store: RuleStore
  #rules: ToolRule[] = []

  constructor(store: RuleStore) {
    this.#store = store
  }

  get rules(): ToolRule[] {
    return [...this.#rules]
  }

  /** Reads the stored list once at startup; a bad value degrades to no rules. */
  async load(): Promise<void> {
    const settings: Record<string, unknown> = await this.#store
      .listSettings()
      .catch(() => ({}) as Record<string, unknown>)
    this.#rules = parseToolRules(settings[KEY])
  }

  /** Replaces the list and persists it; the change is live before this resolves. */
  async save(rules: readonly ToolRule[]): Promise<ToolRule[]> {
    const parsed = parseToolRules([...rules])
    this.#rules = parsed
    await this.#store.putSetting(KEY, parsed as unknown as Record<string, unknown>)
    return this.rules
  }

  /** The deny rule that refuses one call, if the list has one. */
  denyFor(context: { tool: string; args: unknown }): ToolRule | null {
    return matchDenyRule(this.#rules, context)
  }

  /** Whether an allow rule answers this tool's escalation prompt. */
  allows(tool: string): boolean {
    return allowsTool(this.#rules, tool)
  }

  /**
   * Why one call should wait for a person, if it should.
   *
   * A deny never reaches here: it is decided first and refuses the call outright.
   */
  askFor(context: {
    tool: string
    args: unknown
    mutating: boolean
    mode: ApprovalMode
    granted: boolean
  }): ToolAskSource | null {
    return askVerdict(this.#rules, context)
  }
}

/** How a rule reads in a transcript row or an error. */
export function describeRule(rule: ToolRule): string {
  const scope = rule.tool === '*' ? '所有工具' : rule.tool
  return rule.pattern.length === 0 ? scope : `${scope}(${rule.pattern})`
}

/** How much of the arguments the approval card shows. */
const PREVIEW_LIMIT = 240

/** The argument that says what a known tool would do. */
const CALL_FIELDS: Record<string, readonly string[]> = {
  bash: ['command'],
  pwsh: ['command'],
  write: ['file_path', 'path'],
  edit: ['file_path', 'path'],
  read: ['file_path', 'path'],
  glob: ['pattern'],
  grep: ['pattern'],
  web_fetch: ['url'],
  web_search: ['query'],
}

/**
 * What the call would do, in one line.
 *
 * Approving `bash` without seeing the command is approving a name, not an action, so
 * the card leads with the argument that matters for a known tool. An unknown tool has
 * no such field, and guessing one would hide what it is about to do, so its arguments
 * are shown as they arrived.
 */
export function describeCall(tool: string, args: unknown): string | null {
  if (typeof args === 'object' && args !== null) {
    const record = args as Record<string, unknown>
    for (const field of CALL_FIELDS[tool] ?? []) {
      const value = record[field]
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.length <= PREVIEW_LIMIT ? value : `${value.slice(0, PREVIEW_LIMIT)}…`
      }
    }
  }
  return argumentPreview(args)
}

/**
 * A short, honest look at what the call would do.
 *
 * The card has to say more than the tool name — approving `bash` without seeing the
 * command is approving a name, not an action. The raw arguments are shown as they
 * arrived rather than reworded into a sentence, because a summary Pictor composed
 * would be Pictor's claim about the call, not the call.
 */
export function argumentPreview(args: unknown): string | null {
  if (args === null || args === undefined) return null
  let text: string
  try {
    text = JSON.stringify(args) ?? ''
  } catch {
    return null
  }
  if (text.length === 0 || text === '{}') return null
  return text.length <= PREVIEW_LIMIT ? text : `${text.slice(0, PREVIEW_LIMIT)}…`
}

/** What the approval card says about one held call. */
export function describeAsk(source: ToolAskSource, tool: string, args: unknown): string {
  const why =
    source.source === 'rule'
      ? `工具规则「${describeRule(source.rule)}」要求这次调用先问你`
      : '这个会话设置为「改动型工具先问我」'
  const call = describeCall(tool, args)
  return call === null ? why : `${why}\n${call}`
}
