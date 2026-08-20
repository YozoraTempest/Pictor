import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { readPluginEntrypoint, type MainPluginContext } from '../../plugin/entry.js'
import type { PluginDefinition } from '../../plugin/host.js'
import type { AppInfo } from '../../shared/app-info.js'
import { runtimePluginBootstrapSchema, type RuntimePluginBootstrap } from '../../shared/plugins.js'
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

export function createRuntimePluginBootstrap(
  snapshot: PluginStoreSnapshot,
  pictorVersion: string,
  safeMode: boolean,
): RuntimePluginBootstrap {
  return runtimePluginBootstrapSchema.parse({
    pictorVersion,
    safeMode,
    plugins: snapshot.plugins.map(({ entry, manifest, rootPath, dataPath }) => ({
      manifest,
      desiredState: entry.desiredState,
      dataPath,
      runtimeEntryPath: manifest.modules.runtime
        ? resolve(rootPath, manifest.modules.runtime)
        : null,
    })),
    extensions: snapshot.nativeExtensions.flatMap(({ entry, runtimePaths }) =>
      runtimePaths.map((path) => ({ kind: entry.kind, id: entry.id, path })),
    ),
    skills: snapshot.plugins.flatMap(({ manifest, rootPath }) =>
      (manifest.pi?.skills ?? []).map((path) => resolve(rootPath, path)),
    ),
    prompts: snapshot.plugins.flatMap(({ manifest, rootPath }) =>
      (manifest.pi?.prompts ?? []).map((path) => resolve(rootPath, path)),
    ),
  })
}
