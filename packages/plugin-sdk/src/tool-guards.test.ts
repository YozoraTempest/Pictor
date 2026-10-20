import { describe, expect, it, vi } from 'vitest'

import {
  ToolGuardContributionError,
  evaluateToolGuards,
  parseToolGuardContribution,
  parseToolGuardContributions,
  type ToolGuardContribution,
} from './tool-guards.js'

function guard(
  id: string,
  decide: ToolGuardContribution['decide'],
  tools?: string[],
): ToolGuardContribution {
  return { id, decide, ...(tools === undefined ? {} : { tools }) }
}

describe('parseToolGuardContribution', () => {
  it('accepts a guard with a tool filter', () => {
    const decide = (): { decision: 'allow' } => ({ decision: 'allow' })

    expect(
      parseToolGuardContribution({ id: 'safe.bash', title: '禁止 rm', tools: ['bash'], decide }),
    ).toEqual({ id: 'safe.bash', title: '禁止 rm', tools: ['bash'], decide })
  })

  it('accepts a guard without a filter', () => {
    const parsed = parseToolGuardContribution({
      id: 'audit.all',
      decide: () => ({ decision: 'allow' }),
    })

    expect(parsed.tools).toBeUndefined()
    expect(parsed.title).toBeUndefined()
  })

  it('requires an id and a decide function', () => {
    expect(() => parseToolGuardContribution({ decide: () => ({ decision: 'allow' }) })).toThrow(
      ToolGuardContributionError,
    )
    expect(() => parseToolGuardContribution({ id: 'a.b' })).toThrow(/decide must be a function/)
  })

  it('rejects a filter that is not a non-empty list of tool names', () => {
    expect(() =>
      parseToolGuardContribution({ id: 'a.b', tools: [], decide: () => ({ decision: 'allow' }) }),
    ).toThrow(/non-empty array/)
    expect(() =>
      parseToolGuardContribution({
        id: 'a.b',
        tools: ['Bash'],
        decide: () => ({ decision: 'allow' }),
      }),
    ).toThrow(/invalid tool name/)
  })
})

describe('parseToolGuardContributions', () => {
  it('keeps valid guards and reports broken ones', () => {
    const result = parseToolGuardContributions([
      { id: 'a.b', decide: () => ({ decision: 'allow' }) },
      { id: 'bad id', decide: () => ({ decision: 'allow' }) },
    ])

    expect(result.guards.map((entry) => entry.id)).toEqual(['a.b'])
    expect(result.failures[0]?.id).toBe('bad id')
  })

  it('keeps the first guard for a duplicated id', () => {
    const result = parseToolGuardContributions([
      { id: 'a.b', decide: () => ({ decision: 'allow' }) },
      { id: 'a.b', decide: () => ({ decision: 'allow' }) },
    ])

    expect(result.guards).toHaveLength(1)
    expect(result.failures[0]?.reason).toMatch(/duplicate tool guard id/)
  })
})

describe('evaluateToolGuards', () => {
  it('allows when the chain is empty', async () => {
    expect(await evaluateToolGuards([], { tool: 'bash', args: {} })).toEqual({ blocked: false })
  })

  it('stops at the first deny', async () => {
    const second = vi.fn(() => ({ decision: 'deny' as const, reason: 'should not run' }))
    const guards = [
      guard('first.deny', () => ({ decision: 'deny', reason: 'rm is not allowed' })),
      guard('second.deny', second),
    ]

    const verdict = await evaluateToolGuards(guards, { tool: 'bash', args: { cmd: 'rm -rf /' } })

    expect(verdict).toEqual({ blocked: true, reason: 'rm is not allowed', guard: 'first.deny' })
    expect(second).not.toHaveBeenCalled()
  })

  it('skips guards that do not list the tool', async () => {
    const bashGuard = vi.fn(() => ({ decision: 'deny' as const, reason: 'no' }))
    const guards = [guard('only.write', bashGuard, ['write'])]

    const verdict = await evaluateToolGuards(guards, { tool: 'bash', args: {} })

    expect(verdict.blocked).toBe(false)
    expect(bashGuard).not.toHaveBeenCalled()
  })

  it('runs a guard that does list the tool', async () => {
    const guards = [guard('only.bash', () => ({ decision: 'deny', reason: 'no bash' }), ['bash'])]

    expect(await evaluateToolGuards(guards, { tool: 'bash', args: {} })).toMatchObject({
      blocked: true,
      reason: 'no bash',
    })
  })

  it('fails closed when a guard throws', async () => {
    const guards = [
      guard('broken.guard', () => {
        throw new Error('boom')
      }),
    ]

    const verdict = await evaluateToolGuards(guards, { tool: 'bash', args: {} })

    expect(verdict.blocked).toBe(true)
    expect(verdict.reason).toMatch(/broken\.guard failed: boom/)
  })
})
