/**
 * Who is waiting on a person right now.
 *
 * A kernel can hold one call per conversation, and several conversations can be
 * running at once, so "the pending approval" is a list, not a slot. These two
 * helpers are the only place that shape is understood: one answers "what should the
 * window draw", the other "which rows should say so in the sidebar".
 */

/** What every pending request has in common, whichever kernel asked. */
export interface PendingRequest {
  eventId: string
  /** The conversation, when the kernel can name it. dsh's approvals cannot. */
  sessionId?: string
}

/**
 * The request to draw for one conversation, and whether it belongs to another.
 *
 * Its own comes first: a card about the conversation on screen is the one to answer.
 * Otherwise the newest request is shown for any conversation, because a blocked call
 * somewhere is still news — and a kernel that names no conversation (dsh) lands here
 * too, since there is nothing to match on.
 */
export function pendingFor<T extends PendingRequest>(
  requests: readonly T[],
  sessionId: string | null,
): { request: T; foreign: boolean } | null {
  if (requests.length === 0) return null
  const own =
    sessionId === null ? undefined : requests.findLast((entry) => entry.sessionId === sessionId)
  if (own !== undefined) return { request: own, foreign: false }

  const newest = requests[requests.length - 1]
  if (newest === undefined) return null
  // Only a request that names a different conversation is "foreign": one that names
  // none (dsh) is about whatever is open, and the card must not claim otherwise.
  const foreign = newest.sessionId !== undefined && newest.sessionId !== sessionId
  return { request: newest, foreign }
}

/**
 * Conversations that a kernel is holding a call for.
 *
 * Every request that names its conversation, so one badge per blocked row and no
 * badge for a conversation nobody can point at. A request replaces an older one from
 * the same conversation, so a row cannot be listed twice.
 */
export function waitingSessions(requests: readonly PendingRequest[]): Set<string> {
  const waiting = new Set<string>()
  for (const request of requests) {
    if (request.sessionId !== undefined) waiting.add(request.sessionId)
  }
  return waiting
}

/**
 * Adds a request, replacing whatever its conversation was already waiting on.
 *
 * One per conversation is the truth: the kernel holds a call per child process, and a
 * second dialog from the same one means the first was settled.
 */
export function putPending<T extends PendingRequest>(requests: readonly T[], next: T): T[] {
  const rest = requests.filter(
    (entry) => entry.sessionId !== next.sessionId || next.sessionId === undefined,
  )
  // An unnamed request (dsh) cannot replace another unnamed one by conversation, but
  // the newest is the only answerable one, so the older is dropped all the same.
  const kept = next.sessionId === undefined ? rest.filter((e) => e.sessionId !== undefined) : rest
  return [...kept, next]
}

/** Drops one settled request. */
export function dropPending<T extends PendingRequest>(
  requests: readonly T[],
  eventId: string,
): T[] {
  return requests.filter((entry) => entry.eventId !== eventId)
}

/** Drops every request of one conversation, which is what a finished run means. */
export function dropPendingOf<T extends PendingRequest>(
  requests: readonly T[],
  sessionId: string,
): T[] {
  return requests.filter((entry) => entry.sessionId !== sessionId)
}
