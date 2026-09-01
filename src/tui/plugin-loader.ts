import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { readPluginEntrypoint, type TuiPluginContext } from '../plugin/entry.js'
import type { PluginDefinition } from '../plugin/host.js'
import type { PluginManifest } from '../plugin/manifest.js'
import type { InstalledPictorPlugin } from '../plugin/registry.js'

export interface TuiPluginSnapshot {
  readonly entry: Pick<InstalledPictorPlugin, 'desiredState'>
  readonly manifest: PluginManifest
  readonly rootPath: string
}

export function createTuiPluginDefinitions(
  plugins: readonly TuiPluginSnapshot[],
): PluginDefinition[] {
  return plugins.map(({ entry, manifest, rootPath }) => ({
    manifest,
    desiredState: entry.desiredState,
    async createModules() {
      const moduleEntry = manifest.modules.tui
      if (!moduleEntry) return []
      const namespace: unknown = await import(
        pathToFileURL(resolve(rootPath, moduleEntry)).toString()
      )
      if (!namespace || typeof namespace !== 'object') {
        throw new Error(`Invalid TUI Plugin entry: ${manifest.id}`)
      }
      const entrypoint = readPluginEntrypoint<TuiPluginContext>(
        namespace as Record<string, unknown>,
      )
      return entrypoint({ process: 'tui', pluginId: manifest.id })
    },
  }))
}
