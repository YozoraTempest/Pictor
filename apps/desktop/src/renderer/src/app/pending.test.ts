import { describe, expect, it } from 'vitest'

import {
  dropPending,
  dropPendingOf,
  pendingFor,
  putPending,
  waitingSessions,
  type PendingRequest,
} from './pending.js'

function ask(eventId: string, sessionId?: string): PendingRequest {
  return sessionId === undefined ? { eventId } : { eventId, sessionId }
}

describe('pendingFor', () => {
  it('draws the conversation’s own request first', () => {
    // Two conversations blocked at once: the one on screen is the one to answer.
    const picked = pendingFor([ask('a', 's1'), ask('b', 's2')], 's1')

    expect(picked?.request.eventId).toBe('a')
    expect(picked?.foreign).toBe(false)
  })

  it('falls back to the newest request from elsewhere, and says so', () => {
    const picked = pendingFor([ask('a', 's1'), ask('b', 's2')], 's3')

    expect(picked?.request.eventId).toBe('b')
    expect(picked?.foreign).toBe(true)
  })

  it('does not call a request foreign when the kernel named no conversation', () => {
    // dsh's approvals carry no session: the card is about whatever is open, so
    // claiming "from another conversation" would be a guess.
    const picked = pendingFor([ask('a')], 's1')

    expect(picked?.request.eventId).toBe('a')
    expect(picked?.foreign).toBe(false)
  })

  it('has nothing to draw when nothing is held', () => {
    expect(pendingFor([], 's1')).toBeNull()
  })
})

describe('waitingSessions', () => {
  it('names every conversation a kernel is holding', () => {
    expect([...waitingSessions([ask('a', 's1'), ask('b', 's2')])]).toEqual(['s1', 's2'])
  })

  it('skips a request nobody can point at', () => {
    // No session, no badge: a row that said "waiting" for the wrong conversation
    // would send the reader to the wrong place.
    expect([...waitingSessions([ask('a')])]).toEqual([])
  })
})

describe('putPending', () => {
  it('replaces its own conversation’s request', () => {
    const list = putPending([ask('a', 's1')], ask('b', 's1'))

    expect(list.map((entry) => entry.eventId)).toEqual(['b'])
  })

  it('keeps other conversations', () => {
    const list = putPending([ask('a', 's1'), ask('b', 's2')], ask('c', 's1'))

    expect(list.map((entry) => entry.eventId)).toEqual(['b', 'c'])
  })

  it('keeps one unnamed request at a time', () => {
    // dsh's next dialog means the previous one was settled; two answerable cards
    // with no way to tell them apart would be worse than one.
    const list = putPending([ask('a'), ask('b', 's2')], ask('c'))

    expect(list.map((entry) => entry.eventId)).toEqual(['b', 'c'])
  })
})

describe('dropping', () => {
  it('drops one by event, and one conversation by id', () => {
    const list = [ask('a', 's1'), ask('b', 's1'), ask('c', 's2')]

    expect(dropPending(list, 'a').map((entry) => entry.eventId)).toEqual(['b', 'c'])
    expect(dropPendingOf(list, 's1').map((entry) => entry.eventId)).toEqual(['c'])
  })
})
