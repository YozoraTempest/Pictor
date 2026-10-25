/**
 * Contribution point `skills`.
 *
 * A skill is a set of instructions an agent loads on demand: the catalog shows
 * one name and one line, and the body only reaches the model when it is loaded
 * or the user types `/name`. A plugin contributes the same thing a `SKILL.md` on
 * disk would, so a provider of, say, release notes can ship its rules with the
 * plugin instead of asking the user to write a file.
 *
 * Pictor materialises a contribution into its own skill root, which is how the
 * runtime finds it; the plugin never writes to the runtime's home itself.
 */
export interface SkillContribution {
  /** Kebab-case identifier; `/name` invokes it and the `skill` tool loads it. */
  name: string
  /** One line the catalog shows instead of the body. */
  description: string
  /** Markdown instructions, loaded only when the skill is used. */
  body: string
  /** Extra routing guidance shown beside the description when present. */
  whenToUse?: string
  /** Whether the model may load it; defaults to true. */
  modelInvocable?: boolean
  /** Whether a user may invoke it with `/name`; defaults to true. */
  userInvocable?: boolean
}

export interface SkillContributionFailure {
  name?: string
  reason: string
}

export class SkillContributionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SkillContributionError'
  }
}

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_NAME = 64
const MAX_DESCRIPTION = 500
const MAX_WHEN_TO_USE = 300
/** A body larger than this is not instructions, it is a document. */
const MAX_BODY = 200_000

/**
 * Validates one skill.
 *
 * The catalog renders the description on a single line and the filesystem
 * provider parses the frontmatter it is written into, so a description that
 * carries a newline would break both. Everything here fails at the boundary: a
 * malformed contribution must not reach a file the runtime reads.
 */
export function parseSkillContribution(value: unknown): SkillContribution {
  if (typeof value !== 'object' || value === null) {
    throw new SkillContributionError('skill must be an object')
  }

  const record = value as Record<string, unknown>
  const name = typeof record.name === 'string' ? record.name.trim() : ''
  if (name.length === 0) throw new SkillContributionError('skill.name is required')
  if (name.length > MAX_NAME) {
    throw new SkillContributionError(
      `skill.name is longer than ${String(MAX_NAME)} characters: ${name}`,
    )
  }
  if (!NAME_PATTERN.test(name)) {
    throw new SkillContributionError(`skill.name must be kebab-case: ${name}`)
  }

  const description = typeof record.description === 'string' ? record.description.trim() : ''
  if (description.length === 0) {
    throw new SkillContributionError(`skill.description is required: ${name}`)
  }
  if (description.length > MAX_DESCRIPTION) {
    throw new SkillContributionError(`skill.description is too long: ${name}`)
  }
  if (/[\r\n]/.test(description)) {
    throw new SkillContributionError(`skill.description must be one line: ${name}`)
  }

  const body = typeof record.body === 'string' ? record.body.trim() : ''
  if (body.length === 0) throw new SkillContributionError(`skill.body is required: ${name}`)
  if (body.length > MAX_BODY) throw new SkillContributionError(`skill.body is too large: ${name}`)

  const whenToUse = record.whenToUse
  if (whenToUse !== undefined) {
    if (typeof whenToUse !== 'string') {
      throw new SkillContributionError(`skill.whenToUse must be a string: ${name}`)
    }
    if (whenToUse.length > MAX_WHEN_TO_USE || /[\r\n]/.test(whenToUse)) {
      throw new SkillContributionError(`skill.whenToUse must be one short line: ${name}`)
    }
  }

  return {
    name,
    description,
    body,
    ...(typeof whenToUse === 'string' && whenToUse.trim().length > 0
      ? { whenToUse: whenToUse.trim() }
      : {}),
    ...(record.modelInvocable === false ? { modelInvocable: false } : {}),
    ...(record.userInvocable === false ? { userInvocable: false } : {}),
  }
}

/**
 * Validates a batch, keeping the valid skills and reporting the rest.
 *
 * The first contribution claiming a name wins: two plugins shipping the same
 * `release-notes` would otherwise take turns overwriting one another's file.
 */
export function parseSkillContributions(values: readonly unknown[]): {
  skills: SkillContribution[]
  failures: SkillContributionFailure[]
} {
  const skills: SkillContribution[] = []
  const failures: SkillContributionFailure[] = []
  const seen = new Set<string>()

  for (const value of values) {
    try {
      const skill = parseSkillContribution(value)
      if (seen.has(skill.name)) {
        failures.push({ name: skill.name, reason: `duplicate skill name: ${skill.name}` })
        continue
      }
      seen.add(skill.name)
      skills.push(skill)
    } catch (error) {
      const name =
        typeof value === 'object' &&
        value !== null &&
        typeof (value as { name?: unknown }).name === 'string'
          ? (value as { name: string }).name
          : undefined
      failures.push({ ...(name === undefined ? {} : { name }), reason: (error as Error).message })
    }
  }

  return { skills, failures }
}
