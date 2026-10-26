import { describe, expect, it, vi } from 'vitest'

import type { PluginHost } from '@pictor/plugin-host'
import type { ViewContribution } from '@pictor/plugin-sdk'

import { PluginContributions } from './plugin-contributions.js'

/**
 * A host that can be changed between calls.
 *
 * The point of the projection is that the answer follows the host, so the fake has to be
 * able to grow a contribution the way an install does — and bump its revision, which is
 * the only signal the projection listens to.
 */
function host(): {
  host: PluginHost
  put: (point: string, pluginId: string, value: unknown) => void
} {
  const points = new Map<string, Array<{ pluginId: string; value: unknown }>>()
  let revision = 0

  const stub = {
    revision: () => revision,
    contributions: (point: string) => (points.get(point) ?? []).map((entry) => entry.value),
    contributionsWithSource: (point: string) => [...(points.get(point) ?? [])],
  }

  return {
    host: stub as unknown as PluginHost,
    put: (point, pluginId, value) => {
      const values = points.get(point) ?? []
      values.push({ pluginId, value })
      points.set(point, values)
      revision += 1
    },
  }
}

const view: ViewContribution = {
  id: 'acme.today',
  title: '今日',
  data: () => ({ blocks: [{ kind: 'text', text: 'ok' }] }),
}

const panel = { id: 'acme.today.panel', title: '今日', view: 'acme.today' }

function contributionsFor(host: PluginHost, warn: (message: string) => void = () => {}) {
  return new PluginContributions(host, { dataDirectory: (id) => `/tmp/plugin-data/${id}`, warn })
}

describe('PluginContributions', () => {
  it('projects once per revision instead of once per question', () => {
    const fake = host()
    fake.put('views', 'acme.demo', view)
    const contributions = contributionsFor(fake.host)

    expect(contributions.current()).toBe(contributions.current())
  })

  it('answers again after the host changes', () => {
    // This is the whole defect the projection exists for: a plugin installed while the
    // app runs used to contribute nothing until the next launch.
    const fake = host()
    const contributions = contributionsFor(fake.host)
    expect(contributions.current().panels).toHaveLength(0)

    fake.put('views', 'acme.demo', view)
    fake.put('panels', 'acme.demo', panel)

    expect(contributions.current().panels.map((entry) => entry.id)).toEqual(['acme.today.panel'])
  })

  it('drops a panel with no view behind it, and says so once', () => {
    const fake = host()
    fake.put('panels', 'acme.demo', panel)
    const warn = vi.fn()
    const contributions = contributionsFor(fake.host, warn)

    expect(contributions.current().panels).toHaveLength(0)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toMatch(/没有名为 acme\.today 的视图/)

    // Asked again, remembered: one warning per change, not one per panel listing.
    contributions.current()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('hands a view its own directory, from the plugin that contributed it', async () => {
    const fake = host()
    const data = vi.fn(() => ({ blocks: [] }))
    fake.put('views', 'acme.demo', { id: 'acme.today', title: '今日', data })
    const contributions = contributionsFor(fake.host)

    await contributions.current().views.render('acme.today', { sessionId: null })
    expect(data).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: 'acme.demo',
        dataDirectory: '/tmp/plugin-data/acme.demo',
      }),
    )
  })

  it('groups skills per plugin, so one bad skill does not take another plugin down', () => {
    const fake = host()
    fake.put('skills', 'acme.one', { name: 'good', description: 'x', body: '# x' })
    fake.put('skills', 'acme.two', { name: 'bad' })
    const warn = vi.fn()
    const contributions = contributionsFor(fake.host, warn)

    const skills = contributions.current().skills
    expect(skills.get('acme.one')?.map((skill) => skill.name)).toEqual(['good'])
    expect(skills.get('acme.two')).toEqual([])
    expect(warn.mock.calls.map((call) => String(call[0]))).toContainEqual(
      expect.stringMatching(/skill ignored/),
    )
  })

  it('reads guards and hooks from the same projection', () => {
    const fake = host()
    fake.put('toolGuards', 'acme.demo', {
      id: 'acme.no-rm',
      tools: ['bash'],
      decide: () => ({ decision: 'deny', reason: '不要 rm' }),
    })
    fake.put('toolHooks', 'acme.demo', { id: 'acme.lint', after: () => undefined })

    const set = contributionsFor(fake.host).current()
    expect(set.guards.map((guard) => guard.id)).toEqual(['acme.no-rm'])
    expect(set.hooks.map((hook) => hook.id)).toEqual(['acme.lint'])
  })
})
