import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import { ContributionHost } from '@vulonlok/plugin-sdk'
import { describe, expect, it } from 'vitest'

import { PluginContainer } from './container.js'
import type { DiscoveredPlugin } from './registry.js'

/**
 * A container that mounts real modules from a temporary directory.
 *
 * These are integration tests on purpose: what is under test is whether *cordis* unloads
 * a plugin's contributions when its fiber goes away. A stub would prove the stub works.
 */
function plugin(parent: string, name: string, source: string): DiscoveredPlugin {
  const root = join(parent, name.replace(/[^a-z0-9-]/gi, '-'))
  mkdirSync(root, { recursive: true })
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name, version: '1.0.0', type: 'module', main: 'index.js' }),
  )
  writeFileSync(join(root, 'index.js'), source)
  return {
    id: name,
    root,
    manifestPath: join(root, 'package.json'),
    manifest: { id: name, kind: 'cordis', name, version: '1.0.0', main: 'index.js' },
  }
}

function setup(): { container: PluginContainer; contributions: ContributionHost; ctx: Context } {
  const ctx = new Context()
  const contributions = new ContributionHost()
  ctx.provide('pictor', contributions.service())
  return {
    // The runtime passes this in production; without it contributions are recorded but
    // nobody knows whose they are, which is exactly what the third test would catch.
    container: new PluginContainer({
      ctx,
      withOwner: (id, work) => contributions.withOwner(id, work),
    }),
    contributions,
    ctx,
  }
}

describe('PluginContainer', () => {
  it('mounts a cordis plugin and unmounts its contributions with it', async () => {
    // The whole point of moving to cordis: the plugin's registration lifetime is the
    // plugin's lifetime, not a list this app has to remember to prune.
    const { container, contributions } = setup()
    const parent = mkdtempSync(join(tmpdir(), 'pictor-container-'))
    const found = plugin(
      parent,
      '@acme/cordis-thing',
      `export const name = 'cordis-thing'
       export const inject = ['pictor']
       export function apply(ctx) {
         ctx.effect(() => ctx.pictor.panels({ id: 'acme.thing.panel', title: '东西', view: 'acme.thing' }))
       }
      `,
    )

    const mounted = await container.mount(found)

    expect(mounted.state).toBe('active')
    expect(mounted.kind).toBe('cordis')
    expect(contributions.panels.list().map((panel) => panel.id)).toEqual(['acme.thing.panel'])
    // The registry remembers who asked, which is how a view gets its own directory.
    expect(contributions.panels.ownerOf(contributions.panels.list()[0] as never)).toBe(
      '@acme/cordis-thing',
    )

    await container.unmount('@acme/cordis-thing')

    expect(contributions.panels.list()).toEqual([])
  })

  it('keeps a plugin waiting for a service it cannot get, instead of calling it broken', async () => {
    // A dsh plugin injects `tools`, which this host does not provide. It mounts, it does
    // not run, and the report says which service it is waiting for — that is the honest
    // answer for a package written for the other side.
    const { container } = setup()
    const parent = mkdtempSync(join(tmpdir(), 'pictor-container-'))
    const found = plugin(
      parent,
      'dsh-only',
      `export const inject = ['tools']
       export function apply() { throw new Error('不该跑到这里') }
      `,
    )

    const mounted = await container.mount(found)

    expect(mounted.state).toBe('pending')
    expect(mounted.missing).toEqual(['tools'])
  })

  it('refuses a module with neither a default export nor apply', async () => {
    const { container } = setup()
    const parent = mkdtempSync(join(tmpdir(), 'pictor-container-'))
    const found = plugin(parent, 'empty', 'export const nothing = 1\n')

    await expect(container.mount(found)).rejects.toThrow(/既没有 default 导出，也没有 apply/)
    expect(container.failures()[0]?.reason).toMatch(/^empty: /)
  })

  it('reports a plugin whose apply throws, and does not register it', async () => {
    const { container } = setup()
    const parent = mkdtempSync(join(tmpdir(), 'pictor-container-'))
    const found = plugin(parent, 'broken', `export function apply() { throw new Error('boom') }\n`)

    await expect(container.mount(found)).rejects.toThrow(/boom/)
    expect(container.has('broken')).toBe(false)
  })
})
