import type { CatalogSkill } from '@pictor/shared'

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
