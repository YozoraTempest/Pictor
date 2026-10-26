import { describe, expect, it } from 'vitest'

import { jobOf, sessionStates, todosOf } from './harness-session-state.js'

/**
 * These three states are what a conversation *is* right now, so the risk is the same
 * in all of them: a replay that ends on the wrong answer draws a stale list, a mode
 * that turned off, or a job that finished an hour ago.
 */

function write(todos: unknown, seq = 1): Record<string, unknown> {
  return { type: 'todo/write', seq, data: { todos } }
}

describe('todosOf', () => {
  it('keeps the three statuses and drops nothing that has words', () => {
    const todos = todosOf([
      { content: ' 读代码 ', status: 'completed' },
      { content: '写补丁', status: 'in_progress' },
      { content: '跑测试', status: 'pending' },
    ])

    expect(todos).toEqual([
      { content: '读代码', status: 'completed' },
      { content: '写补丁', status: 'in_progress' },
      { content: '跑测试', status: 'pending' },
    ])
  })

  it('draws an unknown status as pending instead of dropping the step', () => {
    // The step exists; hiding it would misreport how much work is left.
    expect(todosOf([{ content: '以后再说', status: 'blocked' }])).toEqual([
      { content: '以后再说', status: 'pending' },
    ])
  })

  it('says nothing when the payload is not a list', () => {
    expect(todosOf(undefined)).toBeNull()
    expect(todosOf({ todos: [] })).toBeNull()
  })
})

describe('jobOf', () => {
  it('reads a registration as a running job', () => {
    expect(jobOf({ jobId: 'bash-1', kind: 'bash', label: 'npm test', startedAt: 1000 })).toEqual({
      id: 'bash-1',
      kind: 'bash',
      label: 'npm test',
      status: 'running',
      startedAt: 1000,
      finishedAt: null,
      detail: null,
    })
  })

  it('reads the settlement, which repeats the registration fields', () => {
    expect(
      jobOf({
        jobId: 'bash-1',
        kind: 'bash',
        label: 'npm test',
        startedAt: 1000,
        finishedAt: 5000,
        status: 'failed',
        detail: 'exit code: 3',
      }),
    ).toMatchObject({ status: 'failed', finishedAt: 5000, detail: 'exit code: 3' })
  })

  it('falls back to the id as a label rather than drawing an empty row', () => {
    expect(jobOf({ jobId: 'job-9', startedAt: 1 })?.label).toBe('job-9')
    expect(jobOf({ startedAt: 1 })).toBeNull()
  })
})

describe('sessionStates', () => {
  it('keeps the last todo list, not a merge of every write', () => {
    const states = sessionStates([
      write([{ content: 'a', status: 'pending' }]),
      write(
        [
          { content: 'a', status: 'completed' },
          { content: 'b', status: 'in_progress' },
        ],
        2,
      ),
    ])

    expect(states.todos).toEqual([
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
    ])
  })

  it('reports plan mode from its own event, and pending while /plan settles', () => {
    const entering = sessionStates([
      { type: 'command/run', seq: 1, data: { commandId: 'c1', name: 'plan', args: '' } },
    ])
    expect(entering.plan).toEqual({ active: false, pending: true })

    const settled = sessionStates([
      { type: 'command/run', seq: 1, data: { commandId: 'c1', name: 'plan', args: '' } },
      { type: 'plan/mode', seq: 2, data: { active: true } },
    ])
    expect(settled.plan).toEqual({ active: true, pending: false })

    // Leaving is a change too: the same event with `active: false`.
    const leaving = sessionStates([
      { type: 'plan/mode', seq: 1, data: { active: true } },
      { type: 'plan/mode', seq: 2, data: { active: false } },
    ])
    expect(leaving.plan).toEqual({ active: false, pending: false })
  })

  it('clears pending when the command settles, whatever it decided', () => {
    const failed = sessionStates([
      { type: 'command/run', seq: 1, data: { commandId: 'c1', name: 'plan', args: '' } },
      { type: 'command/done', seq: 2, data: { commandId: 'c1', kind: 'error' } },
    ])

    // A failed `/plan` must not leave the badge spinning forever.
    expect(failed.plan).toEqual({ active: false, pending: false })
  })

  it('ignores a `plan` command that never named its input', () => {
    // Commands with `recordInput: false` own their input elsewhere; nothing to track.
    const states = sessionStates([
      { type: 'command/run', seq: 1, data: { commandId: 'c1', name: 'plan' } },
    ])

    expect(states.plan).toEqual({ active: false, pending: false })
  })

  it('keeps a settled job in the roster, with its outcome', () => {
    const states = sessionStates([
      {
        type: 'job/registered',
        seq: 1,
        data: { jobId: 'j1', kind: 'bash', label: 'a', startedAt: 10 },
      },
      {
        type: 'job/registered',
        seq: 2,
        data: { jobId: 'j2', kind: 'bash', label: 'b', startedAt: 20 },
      },
      {
        type: 'job/settled',
        seq: 3,
        data: {
          jobId: 'j1',
          kind: 'bash',
          label: 'a',
          startedAt: 10,
          finishedAt: 30,
          status: 'killed',
        },
      },
    ])

    expect(states.jobs?.map((job) => [job.id, job.status])).toEqual([
      ['j1', 'killed'],
      ['j2', 'running'],
    ])
  })

  it('says nothing about states the kernel never mentioned', () => {
    // A Pi conversation reaches here with no todo, no plan and no jobs: the bar must
    // stay hidden rather than draw three empty shells.
    expect(sessionStates([{ type: 'assistant/message', seq: 1, data: {} }])).toEqual({})
  })
})
