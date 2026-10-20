import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import type { PluginRecord } from '@pictor/shared'

import { discoverPlugins } from './registry.js'

export interface PluginStateStore {
  listPlugins(): Promise<PluginRecord[]>
  upsertPlugin(input: {
    id: string
    version: string
    enabled?: boolean
    source?: string
  }): Promise<PluginRecord>
  setPluginEnabled(id: string, enabled: boolean): Promise<PluginRecord>
  removePlugin(id: string): Promise<void>
}

export interface InstallOptions {
  sourceDirectory: string
  pluginsRoot: string
  store: PluginStateStore
  enabled?: boolean
}

/**
 * Installs a plugin by copying it under the user plugin root.
 *
 * Copying (rather than referencing) keeps the installed set independent of a
 * developer's working tree and mirrors how a third-party plugin behaves.
 */
export async function installPlugin(options: InstallOptions): Promise<PluginRecord> {
  const discovery = discoverPlugins([options.sourceDirectory])
  const plugin = discovery.plugins[0]

  if (plugin === undefined) {
    const reason = discovery.failures[0]?.reason ?? 'manifest.json not found'
    throw new Error(`cannot install plugin: ${reason}`)
  }

  const target = join(options.pluginsRoot, plugin.id)
  mkdirSync(options.pluginsRoot, { recursive: true })
  rmSync(target, { recursive: true, force: true })
  cpSync(options.sourceDirectory, target, { recursive: true })

  return options.store.upsertPlugin({
    id: plugin.manifest.id,
    version: plugin.manifest.version,
    enabled: options.enabled ?? true,
    source: 'user',
  })
}

export async function setPluginEnabled(
  store: PluginStateStore,
  id: string,
  enabled: boolean,
): Promise<PluginRecord> {
  return store.setPluginEnabled(id, enabled)
}

/**
 * Removes the installed copy and its record.
 *
 * `keepData` leaves `<dataRoot>/<plugin id>` untouched so a reinstall can resume
 * with the same local data.
 */
export async function uninstallPlugin(options: {
  id: string
  pluginsRoot: string
  store: PluginStateStore
}): Promise<void> {
  const target = join(options.pluginsRoot, options.id)
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true })
  }
  await options.store.removePlugin(options.id)
}
