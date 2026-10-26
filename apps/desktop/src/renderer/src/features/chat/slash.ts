import type { CatalogSkill } from '@pictor/shared'

import type { KernelCommand } from '../../../../shared/bridge.js'

/** A `/` token being typed, and the span it occupies in the draft. */
export interface SlashToken {
  start: number
  end: number
  query: string
}

/**
 * Reads a skill invocation out of the draft at the caret.
 *
 * The runtime treats `/name` in direct user input as "inject this skill's
 * instructions into the step", so the composer only has to make the token easy
 * to type — it sends the same text either way. The token must start a line or
 * follow a space, which keeps a path like `src/a/b` from opening a menu, and it
 * must not contain a space, so the menu closes once the name is complete.
 */
export function slashTokenAt(value: string, caret: number): SlashToken | null {
  const match = /(?:^|\s)\/([a-z0-9-]*)$/i.exec(value.slice(0, caret))
  if (match === null) return null
  const query = match[1] ?? ''
  // The slash sits just before the query. Measuring from the match start rather
  // than from the caret keeps the span right when the caret sits at the end of a
  // draft that ends mid-word, and when it sits inside a longer token.
  const start = (match.index ?? 0) + match[0].length - query.length - 1
  return { start, end: start + query.length + 1, query }
}

/** How many entries the menu shows at once. */
export const SLASH_MENU_LIMIT = 8

/**
 * The skills a query narrows to.
 *
 * A skill is chosen by its name, but a reader who knows what they want and not
 * what it is called types the description instead, so both are matched. An empty
 * query lists the whole catalog: typing `/` alone is how someone browses.
 */
export function matchSkills(skills: readonly CatalogSkill[], query: string): CatalogSkill[] {
  const needle = query.trim().toLowerCase()
  return skills
    .filter(
      (skill) =>
        needle.length === 0 ||
        skill.name.toLowerCase().includes(needle) ||
        skill.description.toLowerCase().includes(needle),
    )
    .slice(0, SLASH_MENU_LIMIT)
}

/** One row of the `/` menu: a kernel command or a skill. */
export type SlashEntry =
  | { kind: 'command'; name: string; description: string; input?: string }
  | { kind: 'skill'; name: string; description: string }

/**
 * The menu for one query.
 *
 * Commands come first: they are the kernel's own levers, and a reader typing `/c` for
 * `compact` should not have to look past a skill that happens to share the prefix. A
 * command the kernel offered is always listed, because sending it as a prompt instead
 * would reach the model with words it was never meant to read.
 */
export function slashEntries(
  commands: readonly KernelCommand[],
  skills: readonly CatalogSkill[],
  query: string,
): SlashEntry[] {
  const needle = query.trim().toLowerCase()
  const matched = (name: string, description: string): boolean =>
    needle.length === 0 ||
    name.toLowerCase().includes(needle) ||
    description.toLowerCase().includes(needle)

  const fromCommands: SlashEntry[] = commands
    .filter((command) => matched(command.name, command.description))
    .map((command) => ({
      kind: 'command',
      name: command.name,
      description: command.description,
      ...(command.input === undefined ? {} : { input: command.input }),
    }))

  const fromSkills: SlashEntry[] = matchSkills(skills, query).map((skill) => ({
    kind: 'skill',
    name: skill.name,
    description: skill.description,
  }))

  return [...fromCommands, ...fromSkills].slice(0, SLASH_MENU_LIMIT)
}

/** The command a draft is asking to run, or null when it is ordinary text. */
export function commandLineOf(draft: string, commands: readonly KernelCommand[]): string | null {
  const trimmed = draft.trim()
  const match = /^\/([a-z0-9-]+)(?:\s+[\s\S]*)?$/i.exec(trimmed)
  if (match === null) return null
  const name = match[1]?.toLowerCase() ?? ''
  return commands.some((command) => command.name.toLowerCase() === name) ? trimmed : null
}
