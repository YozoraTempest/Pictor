import type { ToolRule } from '@pictor/shared'
import { allowsTool, matchDenyRule, parseToolRules } from '@pictor/shared'

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
}

/** How a rule reads in a transcript row or an error. */
export function describeRule(rule: ToolRule): string {
  const scope = rule.tool === '*' ? '所有工具' : rule.tool
  return rule.pattern.length === 0 ? scope : `${scope}(${rule.pattern})`
}
