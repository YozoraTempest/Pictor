// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { afterEach, describe, expect, it } from 'vitest'

import { PluginStore } from '../node/plugins/plugin-store.js'
import { CreationModeWatcher } from './creation-mode.js'
import { isCreationModePluginOutput } from './creation-mode.js'

describe('CreationModeWatcher', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('reloads only for files consumed by a Development Plugin package', () => {
    expect(isCreationModePluginOutput('manifest.json')).toBe(true)
    expect(isCreationModePluginOutput('dist/gui.js')).toBe(true)
    expect(isCreationModePluginOutput('pi/skills/review/SKILL.md')).toBe(true)
    expect(isCreationModePluginOutput('assets/icon.png')).toBe(true)
    expect(isCreationModePluginOutput('src/gui.tsx')).toBe(false)
    expect(isCreationModePluginOutput('node_modules/dependency/index.js')).toBe(false)
  })

  it('requests a Host reload after live Development Plugin output changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pictor-creation-mode-'))
    roots.push(root)
    const userDataDirectory = join(root, 'user-data')
    const bundledPluginsDirectory = join(root, 'bundled-plugins')
    const pluginDirectory = join(root, 'development-plugin')
    const triggerPath = join(root, 'creation.reload')
    await mkdir(bundledPluginsDirectory, { recursive: true })
    await writeDevelopmentPlugin(pluginDirectory)

    const pluginStore = new PluginStore({ userDataDirectory, bundledPluginsDirectory })
    await pluginStore.initialize()
    await pluginStore.installDevelopmentFromDirectory(pluginDirectory)
    const watcher = new CreationModeWatcher({
      pluginStore,
      userDataDirectory,
      triggerPath,
      debounceMs: 10,
    })
    await watcher.start()

    try {
      await writeFile(join(pluginDirectory, 'dist', 'host.js'), 'export default ["updated"]\n')
      await expect(waitForText(triggerPath, 'output changed')).resolves.toContain(
        'pictor.creation-test output changed',
      )
    } finally {
      watcher.stop()
    }
  })
})

async function writeDevelopmentPlugin(directory: string): Promise<void> {
  await mkdir(join(directory, 'dist'), { recursive: true })
  await writeFile(
    join(directory, 'manifest.json'),
    `${JSON.stringify({
      id: 'pictor.creation-test',
      name: 'Creation Test',
      version: '1.0.0',
      engines: { pictor: '^0.4.0' },
      dependencies: {},
      modules: { host: './dist/host.js' },
    })}\n`,
  )
  await writeFile(join(directory, 'dist', 'host.js'), 'export default []\n')
}

async function waitForText(path: string, expected: string): Promise<string> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    const value = await readFile(path, 'utf8').catch(() => '')
    if (value.includes(expected)) return value
    await delay(20)
  }
  throw new Error(`Timed out waiting for ${expected} in ${path}`)
}
