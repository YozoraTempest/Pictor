import { describe, expect, it, vi } from 'vitest'

import type { ViewContribution, ViewSpec } from '@pictor/plugin-sdk'

import { PluginViews } from './plugin-views.js'

/**
 * The runner is where a plugin's function finally gets called, so the cases that matter
 * are the ones where an answer cannot be drawn: a throw, a shape the window does not know,
 * and a view that never answers at all. Each has to name the plugin, or someone reading the
 * panel goes looking in the wrong place.
 */
function view(
  overrides: Partial<ViewContribution> & Pick<ViewContribution, 'id'>,
): ViewContribution {
  return {
    title: overrides.id,
    data: () => ({ blocks: [{ kind: 'text', text: 'ok' }] }),
    ...overrides,
  }
}

function runner(views: ViewContribution[], timeoutMs = 50): PluginViews {
  return new PluginViews(views, {
    dataDirectory: (pluginId) => `/tmp/plugin-data/${pluginId}`,
    timeoutMs,
  }).withOwners(new Map(views.map((entry) => [entry.id, 'acme.demo'])))
}

describe('PluginViews.render', () => {
  it('runs the view with the context it is allowed to have', async () => {
    const data = vi.fn(async (): Promise<ViewSpec> => ({
      blocks: [{ kind: 'heading', text: '题目' }],
      note: '读于此刻',
    }))
    const views = runner([view({ id: 'acme.status', data })])

    const spec = (await views.render('acme.status', { sessionId: 's1' })) as {
      blocks: unknown[]
      note: string
    }

    expect(spec.note).toBe('读于此刻')
    expect(spec.blocks).toHaveLength(1)
    // The directory is the contributing plugin's own, not one the caller named.
    expect(data).toHaveBeenCalledWith({
      sessionId: 's1',
      dataDirectory: '/tmp/plugin-data/acme.demo',
      pluginId: 'acme.demo',
    })
  })

  it('reports a plugin that throws as that plugin failing', async () => {
    const views = runner([
      view({
        id: 'acme.status',
        title: '状态',
        data: () => {
          throw new Error('git 不在 PATH 里')
        },
      }),
    ])

    await expect(views.render('acme.status', { sessionId: null })).rejects.toThrow(
      /视图「状态」没有产出内容：git 不在 PATH 里/,
    )
  })

  it('reports a malformed answer instead of drawing half of it', async () => {
    const views = runner([
      view({
        id: 'acme.status',
        title: '状态',
        data: () => ({ blocks: [{ kind: 'chart' }] }) as unknown as ViewSpec,
      }),
    ])

    await expect(views.render('acme.status', { sessionId: null })).rejects.toThrow(
      /不符合契约：view\.blocks\[0\]\.kind is not one this window draws: chart/,
    )
  })

  it('gives up on a view that never answers', async () => {
    const views = runner([
      view({ id: 'acme.slow', title: '慢', data: () => new Promise(() => {}) }),
    ])

    await expect(views.render('acme.slow', { sessionId: null })).rejects.toThrow(
      /视图「慢」没有产出内容：.*没有回答/,
    )
  })

  it('refuses a view nobody contributed', async () => {
    await expect(runner([]).render('acme.nope', { sessionId: null })).rejects.toThrow(
      /没有这个视图：acme.nope/,
    )
  })
})
