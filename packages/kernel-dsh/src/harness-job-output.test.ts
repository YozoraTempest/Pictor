import { describe, expect, it } from 'vitest'

import { jobOutputOf } from './harness-job-output.js'

/**
 * The stream is the only place a job's output exists, so this mapping decides what a
 * person gets to read: which stream said what, whether the job is still going, and
 * whether the runtime admitted to dropping anything.
 */
describe('jobOutputOf', () => {
  it('keeps the stream each chunk came from, and joins them for copying', () => {
    const read = jobOutputOf([
      { type: 'opened', job: { id: 'j1' }, from: 0 },
      {
        type: 'output',
        chunks: [
          { at: 0, channel: 'stdout', text: 'building\n' },
          { at: 9, channel: 'stderr', text: 'warn: unused\n' },
          { at: 23, channel: 'stdout', text: 'done\n' },
        ],
        next: 28,
      },
    ])

    expect(read.segments).toEqual([
      { channel: 'stdout', text: 'building\n' },
      { channel: 'stderr', text: 'warn: unused\n' },
      { channel: 'stdout', text: 'done\n' },
    ])
    expect(read.text).toBe('building\nwarn: unused\ndone\n')
  })

  it('calls a read without a terminal frame partial', () => {
    // A running job never sends `status`; saying "finished" here would be the lie.
    expect(
      jobOutputOf([
        { type: 'opened', from: 0 },
        { type: 'output', chunks: [] },
      ]).partial,
    ).toBe(true)
  })

  it('calls a settled job complete', () => {
    const read = jobOutputOf([
      { type: 'opened', from: 0 },
      { type: 'output', chunks: [{ text: 'ok\n' }], next: 3 },
      { type: 'status', job: { id: 'j1', status: 'completed' } },
    ])

    expect(read.partial).toBe(false)
  })

  it('notes every way the runtime says something was dropped', () => {
    // A non-zero start offset, a lossy batch, and a marked gap all mean the same thing to
    // a reader: this is not the whole output.
    expect(jobOutputOf([{ type: 'opened', from: 512 }]).lossy).toBe(true)
    expect(jobOutputOf([{ type: 'output', chunks: [], lossy: true }]).lossy).toBe(true)
    expect(jobOutputOf([{ type: 'output', chunks: [{ text: 'x', gapBefore: true }] }]).lossy).toBe(
      true,
    )
  })

  it('survives frames it does not understand', () => {
    expect(jobOutputOf([null, 42, { type: 'nope' }, { type: 'output', chunks: 'no' }])).toEqual({
      segments: [],
      text: '',
      partial: true,
      lossy: false,
    })
  })
})
