import { describe, expect, it } from 'vitest'

import type { ChatJob } from '@pictor/shared'

import { applyPlanEvent, liveJobs, mergeJobs, todoSummary } from './session-state.js'

function job(overrides: Partial<ChatJob> & Pick<ChatJob, 'id'>): ChatJob {
  return {
    kind: 'bash',
    label: overrides.id,
    status: 'running',
    startedAt: 1,
    finishedAt: null,
    detail: null,
    ...overrides,
  }
}

describe('applyPlanEvent', () => {
  it('keeps the mode a command in flight found', () => {
    // `/plan` issued but not settled: the mode has not moved yet, and flipping the
    // badge early would be a promise the runtime has not made.
    expect(
      applyPlanEvent({ active: true, pending: false }, { active: null, pending: true }),
    ).toEqual({
      active: true,
      pending: true,
    })
  })

  it('takes the mode a real change reports', () => {
    expect(
      applyPlanEvent({ active: true, pending: true }, { active: false, pending: false }),
    ).toEqual({ active: false, pending: false })
  })

  it('starts from off when the first event only says a command is running', () => {
    expect(applyPlanEvent(null, { active: null, pending: true })).toEqual({
      active: false,
      pending: true,
    })
  })
})

describe('mergeJobs', () => {
  it('takes the roster for every job it names', () => {
    const merged = mergeJobs([job({ id: 'j1' })], [job({ id: 'j1', status: 'completed' })])

    expect(merged.map((entry) => [entry.id, entry.status])).toEqual([['j1', 'completed']])
  })

  it('closes a job the runtime no longer has instead of leaving it running', () => {
    // The runtime that owned it died: a row claiming to run would never finish.
    const merged = mergeJobs([job({ id: 'j1' })], [])

    expect(merged[0]).toMatchObject({ status: 'failed', detail: '运行时已不再持有这个任务' })
  })

  it('keeps a finished job the roster forgot, because it is history now', () => {
    const merged = mergeJobs([job({ id: 'j1', status: 'completed' })], [])

    expect(merged[0]?.status).toBe('completed')
  })

  it('orders by when each job started', () => {
    const merged = mergeJobs(
      [job({ id: 'late', startedAt: 30 }), job({ id: 'early', startedAt: 10 })],
      [],
    )

    expect(merged.map((entry) => entry.id)).toEqual(['early', 'late'])
  })
})

describe('todoSummary', () => {
  it('counts what is done and names what is being worked on', () => {
    expect(
      todoSummary([
        { content: '一', status: 'completed' },
        { content: '二', status: 'completed' },
        { content: '三', status: 'in_progress' },
        { content: '四', status: 'pending' },
      ]),
    ).toEqual({ done: 2, total: 4, current: '三' })
  })

  it('has no current step when nothing is in progress', () => {
    expect(todoSummary([{ content: '一', status: 'pending' }])).toEqual({
      done: 0,
      total: 1,
      current: null,
    })
  })
})

describe('liveJobs', () => {
  it('counts what still occupies the runtime', () => {
    const jobs = [
      job({ id: 'a' }),
      job({ id: 'b', status: 'stopping' }),
      job({ id: 'c', status: 'completed' }),
    ]

    expect(liveJobs(jobs).map((entry) => entry.id)).toEqual(['a', 'b'])
  })
})
