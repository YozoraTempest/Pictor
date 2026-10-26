import { describe, expect, it } from 'vitest'

import {
  evaluateToolHooks,
  hookOutputOf,
  parseToolHookContributions,
  type ToolHookContext,
  type ToolHookContribution,
} from './tool-hooks.js'

/**
 * Hooks sit on the far side of a call that already happened, so the budget for getting
 * them wrong is smaller than a guard's: a guard that refuses is visible, while a hook
 * that silently rewrites what the model reads is not. These cases pin the three things
 * that would be invisible in production — order, attribution, and what a failure means.
 */

function context(overrides: Partial<ToolHookContext> = {}): ToolHookContext {
  return { tool: 'bash', args: {}, session: 's1', ok: true, output: 'ok', ...overrides }
}

function hook(
  overrides: Partial<ToolHookContribution> & Pick<ToolHookContribution, 'id'>,
): ToolHookContribution {
  return { after: () => undefined, ...overrides }
}

describe('parseToolHookContributions', () => {
  it('keeps the valid hooks and reports the rest', () => {
    const { hooks, failures } = parseToolHookContributions([
      { id: 'a.ok', after: () => undefined },
      { id: 'b.broken' },
      { id: 'a.ok', after: () => undefined },
      { id: 'c.wild', tools: ['mcp__github__*'], after: () => undefined },
      { id: 'd.bad', tools: ['mcp__*__write'], after: () => undefined },
    ])

    expect(hooks.map((entry) => entry.id)).toEqual(['a.ok', 'c.wild'])
    expect(failures.map((entry) => entry.id)).toEqual(['b.broken', 'a.ok', 'd.bad'])
  })
})

describe('evaluateToolHooks', () => {
  it('runs every matching hook and attributes each note', async () => {
    const outcome = await evaluateToolHooks(
      [
        hook({ id: 'acme.first', after: () => ({ note: '第一句' }) }),
        hook({ id: 'acme.second', after: () => ({ note: '第二句' }) }),
        hook({ id: 'acme.other', tools: ['read'], after: () => ({ note: '不该出现' }) }),
      ],
      context(),
    )

    // One hook's note is not a reason to hide another's.
    expect(outcome.note).toBe('[acme.first] 第一句\n\n[acme.second] 第二句')
    expect(outcome.fail).toBeUndefined()
  })

  it('lets the first failure win, because two replacements cannot be joined', async () => {
    const outcome = await evaluateToolHooks(
      [
        hook({ id: 'acme.first', after: () => ({ fail: '先停' }) }),
        hook({ id: 'acme.second', after: () => ({ fail: '后停' }) }),
      ],
      context(),
    )

    expect(outcome.fail).toBe('[acme.first] 先停')
  })

  it('skips a hook that throws and says which one', async () => {
    // Fail open: an observation must not be able to break a conversation.
    const outcome = await evaluateToolHooks(
      [
        hook({
          id: 'acme.broken',
          after: () => {
            throw new Error('boom')
          },
        }),
        hook({ id: 'acme.fine', after: () => ({ note: '还在' }) }),
      ],
      context(),
    )

    expect(outcome.note).toBe('[acme.fine] 还在')
    expect(outcome.failures).toEqual([
      { id: 'acme.broken', reason: 'tool hook acme.broken failed: boom' },
    ])
  })

  it('matches a hook restricted to a namespace', async () => {
    const seen: string[] = []
    const hooks = [
      hook({
        id: 'acme.mcp',
        tools: ['mcp__github__*'],
        after: (current) => {
          seen.push(current.tool)
        },
      }),
    ]

    await evaluateToolHooks(hooks, context({ tool: 'mcp__github__create_issue' }))
    await evaluateToolHooks(hooks, context({ tool: 'bash' }))

    expect(seen).toEqual(['mcp__github__create_issue'])
  })

  it('says nothing when a hook returns nothing', async () => {
    const outcome = await evaluateToolHooks([hook({ id: 'acme.quiet' })], context())

    expect(outcome).toEqual({ failures: [] })
  })
})

describe('hookOutputOf', () => {
  it('hands over a short result unchanged', () => {
    expect(hookOutputOf('ok')).toBe('ok')
  })

  it('clips a long one and says so', () => {
    const clipped = hookOutputOf('x'.repeat(5_000))

    // A transcript copy may be megabytes; a hook that needs all of it should read the
    // file the tool touched instead.
    expect(clipped.length).toBeLessThan(5_000)
    expect(clipped).toContain('已截断，共 5000 字符')
  })
})
