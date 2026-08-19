import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { readPluginEntrypoint, type MainPluginContext } from '../../plugin/entry.js'
import type { PluginDefinition } from '../../plugin/host.js'
import type { AppInfo } from '../../shared/app-info.js'
import type { PluginStoreSnapshot } from './plugin-store.js'

export function createMainPluginDefinitions(
  snapshot: PluginStoreSnapshot,
  appInfo: AppInfo,
): PluginDefinition[] {
  return snapshot.plugins.map(({ entry, manifest, rootPath, dataPath }) => ({
    manifest,
    desiredState: entry.desiredState,
    async createModules() {
      const moduleEntry = manifest.modules.main
      if (!moduleEntry) return []
      const namespace: unknown = await import(
        pathToFileURL(resolve(rootPath, moduleEntry)).toString()
      )
      if (!namespace || typeof namespace !== 'object') {
        throw new Error(`Invalid Main Plugin entry: ${manifest.id}`)
      }
      const entrypoint = readPluginEntrypoint<MainPluginContext>(
        namespace as Record<string, unknown>,
      )
      return entrypoint({ process: 'main', dataPath, appInfo })
    },
  }))
}
