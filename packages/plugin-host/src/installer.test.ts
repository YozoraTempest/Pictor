import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { PluginRecord } from '@pictor/shared'

import { installPlugin, uninstallPlugin, type PluginStateStore } from './installer.js'

class MemoryStore implements PluginStateStore {
  readonly records = new Map<string, PluginRecord>()

  async listPlugins(): Promise<PluginRecord[]> {
    return [...this.records.values()]
  }

  async upsertPlugin(input: {
    id: string
    version: string
    enabled?: boolean
    source?: string
  }): Promise<PluginRecord> {
    const record: PluginRecord = {
      id: input.id,
      version: input.version,
      enabled: input.enabled ?? true,
      source: input.source ?? 'user',
      installedAt: Date.now(),
    }
    this.records.set(input.id, record)
    return record
  }

  async setPluginEnabled(id: string, enabled: boolean): Promise<PluginRecord> {
    const record = this.records.get(id)
    if (record === undefined) throw new Error('missing plugin')
    const updated = { ...record, enabled }
    this.records.set(id, updated)
    return updated
  }

  async removePlugin(id: string): Promise<void> {
    this.records.delete(id)
  }
}

function writeSource(root: string): void {
  mkdirSync(join(root, 'dist'), { recursive: true })
  writeFileSync(
    join(root, 'manifest.json'),
    JSON.stringify({
      id: 'pictor.sample',
      name: 'Sample',
      version: '1.2.3',
      main: 'dist/index.js',
      engines: { pictor: '^1.0.0' },
    }),
  )
  writeFileSync(join(root, 'dist', 'index.js'), 'export default {}')
}

describe('installer', () => {
  it('copies a plugin and records it', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'pictor-install-'))
    const source = join(workspace, 'source')
    const pluginsRoot = join(workspace, 'plugins')
    writeSource(source)

    const store = new MemoryStore()
    const record = await installPlugin({ sourceDirectory: source, pluginsRoot, store })

    expect(record).toMatchObject({ id: 'pictor.sample', version: '1.2.3', enabled: true })
    expect(existsSync(join(pluginsRoot, 'pictor.sample', 'manifest.json'))).toBe(true)
    expect(store.records.has('pictor.sample')).toBe(true)
  })

  it('rejects a source without a valid manifest', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'pictor-install-'))
    const source = join(workspace, 'source')
    mkdirSync(source, { recursive: true })

    await expect(
      installPlugin({
        sourceDirectory: source,
        pluginsRoot: join(workspace, 'plugins'),
        store: new MemoryStore(),
      }),
    ).rejects.toThrow(/cannot install plugin/)
  })

  it('removes the installed copy and record on uninstall', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'pictor-install-'))
    const source = join(workspace, 'source')
    const pluginsRoot = join(workspace, 'plugins')
    writeSource(source)

    const store = new MemoryStore()
    await installPlugin({ sourceDirectory: source, pluginsRoot, store })
    await uninstallPlugin({ id: 'pictor.sample', pluginsRoot, store })

    expect(existsSync(join(pluginsRoot, 'pictor.sample'))).toBe(false)
    expect(store.records.size).toBe(0)
  })
})
