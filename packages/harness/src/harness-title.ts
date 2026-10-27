import type { SessionWireEvent } from '@vulonlok/harness-dsh'
import { isAutoSessionTitle } from '@vulonlok/shared'

/**
 * The name the runtime gave a conversation, if this event carries one.
 *
 * A session log records two of them: a fallback built from the first prompt, then
 * the llm-generated name once the title call returns. Both arrive as
 * `session/title`; later ones are better, so the caller simply applies each.
 */
export function sessionTitleOf(event: SessionWireEvent): string | null {
  if (event.type !== 'session/title') return null
  const data = (event.data ?? {}) as Record<string, unknown>
  const title = typeof data['title'] === 'string' ? data['title'].trim() : ''
  // An empty title would wipe the row's name; a runtime that had nothing to say
  // should not get to rename anything.
  return title.length === 0 ? null : title
}

/**
 * Whether the runtime's name may replace the one on the row.
 *
 * Three cases matter. A placeholder nobody has touched is free to replace. A name
 * the runtime produced earlier may be replaced by a better one it produced later —
 * the fallback comes first, the generated name second. Anything else is the user's
 * own, and a title they typed must survive.
 */
export function shouldAdoptTitle(
  current: string,
  incoming: string,
  runtimeTitles: ReadonlySet<string>,
): boolean {
  if (current === incoming) return false
  if (isAutoSessionTitle(current)) return true
  return runtimeTitles.has(current)
}
