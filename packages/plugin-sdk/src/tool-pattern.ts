/**
 * One way to name a tool, for every contribution that has to name one.
 *
 * Three points in this SDK talk about tool names: a guard polices a call, a view
 * decides how it reads, and a hook reacts to how it ended. They must agree on what a
 * name means, or a guard and its view could disagree about which tool they are
 * describing.
 *
 * Two forms are accepted:
 *
 * - An exact name (`read`, `str_replace_editor`) — what Pictor has always allowed.
 * - A prefix with a trailing `*` (`mcp__github__*`) — because a tool that arrived through
 *   an MCP server is named after a server nobody knew about when the app was built, and
 *   a plugin that dresses up a whole namespace cannot enumerate it in advance.
 *
 * A name is matched by a *prefix*, never a glob in the middle: `mcp__*__write` would
 * make which tool a rule covers depend on a pattern language, and a policy that is hard
 * to read is a policy people get wrong.
 */

/**
 * What may appear in a name, before an optional trailing `*`.
 *
 * Deliberately one rule for both forms. An MCP tool is named `mcp__server__tool`, with
 * doubled separators an ordinary tool name never has, and a stricter regex would have
 * refused the very names this whole matcher exists for — while still accepting every
 * name Pictor's own tools use.
 */
const NAME = /^[a-z0-9][a-z0-9._-]*$/

/** Longest name a contribution may write; a pattern that long is a mistake. */
const MAX_PATTERN = 64

/** Whether a contribution may name a tool this way. */
export function isToolPattern(value: string): boolean {
  if (value.length === 0 || value.length > MAX_PATTERN) return false
  // A `*` is only ever allowed as the last character: no globs in the middle.
  const name = value.endsWith('*') ? value.slice(0, -1) : value
  if (name.length === 0 || name.includes('*')) return false
  return NAME.test(name)
}

/**
 * Whether `name` is covered by `pattern`.
 *
 * A pattern with no `*` must equal the name. A pattern ending in `*` covers every name
 * that starts with its prefix, and only a whole prefix counts: `mcp__git*` covers
 * `mcp__github__create_issue` as well as `mcp__gitea__x`, which is exactly what a
 * server-named tool requires.
 */
export function matchesTool(pattern: string, name: string): boolean {
  if (!pattern.endsWith('*')) return pattern === name
  return name.startsWith(pattern.slice(0, -1))
}

/**
 * How specific a pattern is; higher wins when two patterns both match.
 *
 * An exact name is always the most specific thing anyone can say. Among prefixes, the
 * longest covers the fewest tools, so it is the closer answer to the question "how
 * should this one read".
 */
export function toolPatternSpecificity(pattern: string): number {
  return pattern.endsWith('*') ? pattern.length - 1 : Number.MAX_SAFE_INTEGER
}
