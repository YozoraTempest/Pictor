/**
 * Tool rules: the per-tool policy a person writes for their own machine.
 *
 * A rule names one agent tool and, for a deny, a glob over the argument that
 * matters for that tool — `bash` has a command, `write` a path, `web_fetch` a
 * URL. Denying is exact: the guard sees the real arguments and refuses the call
 * before it runs.
 *
 * Allowing cannot be exact, because the runtime's approval request carries only
 * the tool name and a reason, never the arguments. An allow rule therefore means
 * "this tool's escalation prompt is answered for me", which is narrower than what
 * a deny can express; the settings page says so rather than implying otherwise.
 */
export type ToolRuleEffect = 'allow' | 'deny'

export interface ToolRule {
  /** Stable id, so a row can be edited or removed without matching its text. */
  id: string
  effect: ToolRuleEffect
  /** Agent tool name, or `*` for every tool. */
  tool: string
  /** Glob over the argument that matters; empty means "any argument". */
  pattern: string
}

/** The arguments a rule is matched against, per tool. */
const SUBJECT_FIELDS: Record<string, readonly string[]> = {
  bash: ['command'],
  pwsh: ['command'],
  read: ['file_path', 'path'],
  write: ['file_path', 'path'],
  edit: ['file_path', 'path'],
  str_replace_editor: ['path', 'file_path'],
  glob: ['pattern'],
  grep: ['pattern', 'path'],
  web_fetch: ['url'],
  web_search: ['query'],
}

const TOOL_PATTERN = /^(?:\*|[a-z0-9]+(?:_[a-z0-9]+)*)$/
const MAX_PATTERN = 200

export class ToolRuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolRuleError'
  }
}

/**
 * Collects every string inside a value.
 *
 * An unknown tool has no known argument name, so the whole argument object is
 * flattened: a rule that names a path must still be able to match a tool this
 * build has never heard of.
 */
function stringsIn(value: unknown, depth = 0): string[] {
  if (depth > 4) return []
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap((entry) => stringsIn(entry, depth + 1))
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).flatMap((entry) => stringsIn(entry, depth + 1))
  }
  return []
}

/** The values one rule is compared against for one call. */
export function ruleSubjects(tool: string, args: unknown): string[] {
  const fields = SUBJECT_FIELDS[tool]
  if (fields !== undefined && typeof args === 'object' && args !== null) {
    const record = args as Record<string, unknown>
    const picked = fields.flatMap((field) => stringsIn(record[field]))
    if (picked.length > 0) return picked
  }
  return stringsIn(args)
}

/** Escapes everything a regex treats specially, then widens `*`. */
function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`, 'u')
}

/** Whether one argument value matches a rule's glob. */
export function matchesGlob(glob: string, value: string): boolean {
  if (glob.length === 0) return true
  return globToRegExp(glob).test(value)
}

function ruleAppliesTo(rule: ToolRule, tool: string): boolean {
  return rule.tool === '*' || rule.tool === tool
}

/**
 * The deny rule that refuses one call, if any.
 *
 * The first match wins, so a reader's list reads like a policy: whichever rule
 * they put first is the reason they will see.
 */
export function matchDenyRule(
  rules: readonly ToolRule[],
  context: { tool: string; args: unknown },
): ToolRule | null {
  const subjects = ruleSubjects(context.tool, context.args)
  for (const rule of rules) {
    if (rule.effect !== 'deny') continue
    if (!ruleAppliesTo(rule, context.tool)) continue
    if (rule.pattern.length === 0) return rule
    if (subjects.some((subject) => matchesGlob(rule.pattern, subject))) return rule
  }
  return null
}

/** Whether an allow rule covers this tool, for answering its approval prompt. */
export function allowsTool(rules: readonly ToolRule[], tool: string): boolean {
  return rules.some((rule) => rule.effect === 'allow' && ruleAppliesTo(rule, tool))
}

/**
 * Validates the stored list.
 *
 * A malformed entry is dropped rather than failing the page: one bad row must
 * not take the rest of a person's policy away. What arrives is the only writer of
 * this shape, so a value that is not an array at all is an error.
 */
export function parseToolRules(value: unknown): ToolRule[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new ToolRuleError('rules: 规则必须是数组')

  const seen = new Set<string>()
  return value.flatMap((entry): ToolRule[] => {
    if (typeof entry !== 'object' || entry === null) return []
    const record = entry as Record<string, unknown>
    const id = record['id']
    const effect = record['effect']
    const tool = record['tool']
    const pattern = record['pattern']
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) return []
    if (effect !== 'allow' && effect !== 'deny') return []
    if (typeof tool !== 'string' || !TOOL_PATTERN.test(tool)) return []
    if (typeof pattern !== 'string' || pattern.length > MAX_PATTERN || /[\r\n]/.test(pattern))
      return []
    seen.add(id)
    return [{ id, effect, tool, pattern }]
  })
}
