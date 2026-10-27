import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import { ContributionHost } from '@pictor/plugin-sdk'
import { describe, expect, it } from 'vitest'

import { PluginContainer } from './container.js'
import type { DiscoveredPlugin } from './registry.js'
import { PluginWatcher } from './watcher.js'

/**
 * Reloading without a restart.
 *
 * These tests write a real file and wait for a real file-system event, because the thing
 * under test is whether edited code runs — a fake watcher would only prove the fake.
 * They are the reason the app can promise "save and it is live" on a platform whose HMR
 * package cannot start (see `watcher.ts`).
 */
function setup() {
  const ctx = new Context()
  const contributions = new ContributionHost()
  ctx.provide('pictor', contributions.service())
  const container = new PluginContainer({
    ctx,
    withOwner: (id, work) => contributions.withOwner(id, work),
  })
  return { container, contributions }
}

function pluginDir(version: string): DiscoveredPlugin {
  const parent = mkdtempSync(join(tmpdir(), 'pictor-reload-'))
  const root = join(parent, 'reloadable')
  mkdirSync(root, { recursive: true })
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'reloadable', version: '1.0.0', type: 'module', main: 'index.js' }),
  )
  writeFileSync(join(root, 'index.js'), sourceFor(version))
  return {
    id: 'reloadable',
    root,
    manifestPath: join(root, 'package.json'),
    manifest: {
      id: 'reloadable',
      kind: 'cordis',
      name: 'reloadable',
      version: '1.0.0',
      main: 'index.js',
    },
  }
}

function sourceFor(version: string): string {
  return `export const inject = ['pictor']
export function apply(ctx) {
  ctx.effect(() => ctx.pictor.panels({ id: 'acme.reload.panel', title: '${version}', view: 'acme.reload' }))
}
`
}

/** Waits for a condition, because a file-system event has no promise to await. */
async function until(check: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (check()) return true
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return check()
}

describe('PluginContainer.reload', () => {
  it('runs the edited file, and drops the contributions of the old one first', async () => {
    const { container, contributions } = setup()
    const found = pluginDir('第一版')

    await container.mount(found)
    expect(contributions.panels.list().map((panel) => panel.title)).toEqual(['第一版'])

    // Edit the file, then reload: this is what the watcher asks for.
    writeFileSync(join(found.root, 'index.js'), sourceFor('第二版'))
    await container.reload('reloadable')

    // One panel, not two: the old fiber was disposed before the new code ran, so the
    // second registration was not refused as a duplicate.
    expect(contributions.panels.list().map((panel) => panel.title)).toEqual(['第二版'])
  })
})

describe('PluginWatcher', () => {
  it('reloads a plugin after its file changes', async () => {
    const { container, contributions } = setup()
    const found = pluginDir('第一版')
    await container.mount(found)

    let reloads = 0
    const watcher = new PluginWatcher({
      debounceMs: 30,
      reload: async (id) => {
        reloads += 1
        await container.reload(id)
      },
    })
    watcher.watch('reloadable', found.root)

    try {
      writeFileSync(join(found.root, 'index.js'), sourceFor('第二版'))

      expect(await until(() => contributions.panels.list()[0]?.title === '第二版')).toBe(true)
      expect(reloads).toBeGreaterThanOrEqual(1)
    } finally {
      watcher.close()
    }
  })

  it('ignores writes inside a plugin’s node_modules', async () => {
    // A dependency tree is not the plugin's code; reloading for an install would be
    // reloading for something nobody edited.
    const { container } = setup()
    const found = pluginDir('第一版')
    await container.mount(found)

    let reloads = 0
    const watcher = new PluginWatcher({
      debounceMs: 20,
      reload: async (id) => {
        reloads += 1
        await container.reload(id)
      },
    })
    watcher.watch('reloadable', found.root)

    try {
      const dependency = join(found.root, 'node_modules', 'left-pad')
      mkdirSync(dependency, { recursive: true })
      writeFileSync(join(dependency, 'index.js'), 'export default 1\n')
      await new Promise((resolve) => setTimeout(resolve, 400))

      expect(reloads).toBe(0)
    } finally {
      watcher.close()
    }
  })

  it('stops watching once closed', async () => {
    const { container } = setup()
    const found = pluginDir('第一版')
    await container.mount(found)

    const watcher = new PluginWatcher({ reload: async () => undefined })
    watcher.watch('reloadable', found.root)
    expect(watcher.watching()).toEqual(['reloadable'])

    watcher.close()
    expect(watcher.watching()).toEqual([])
  })
})
