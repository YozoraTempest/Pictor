import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { readPluginEntrypoint, type HostPluginContext, type RuntimePluginContext } from './entry.js'
import type { PluginDefinition } from './host.js'
import type { PluginManifest } from './manifest.js'
import type { InstalledExtension, InstalledPictorPlugin } from './registry.js'
import { runtimePluginBootstrapSchema, type RuntimePluginBootstrap } from '../shared/plugins.js'

export interface PluginStoreSnapshotForLoading {
  readonly plugins: readonly {
    readonly entry: InstalledPictorPlugin
    readonly manifest: PluginManifest
    readonly rootPath: string
    readonly dataPath: string
  }[]
  readonly nativeExtensions: readonly {
    readonly entry: Exclude<InstalledExtension, { kind: 'pictor-plugin' }>
    readonly runtimePath: string
  }[]
}

export function createHostPluginDefinitions(
  snapshot: PluginStoreSnapshotForLoading,
  appInfo: unknown,
  resolveHost: (pluginId: string) => unknown = () => undefined,
): PluginDefinition[] {
  return snapshot.plugins.map(({ entry, manifest, rootPath, dataPath }) => ({
    manifest,
    desiredState: entry.desiredState,
    async createModules() {
      const moduleEntry = manifest.modules.host
      if (!moduleEntry) return []
      const namespace: unknown = await import(
        pathToFileURL(resolve(rootPath, moduleEntry)).toString()
      )
      if (!namespace || typeof namespace !== 'object') {
        throw new Error(`Invalid Host Plugin entry: ${manifest.id}`)
      }
      const entrypoint = readPluginEntrypoint<HostPluginContext>(
        namespace as Record<string, unknown>,
      )
      return entrypoint({ process: 'host', dataPath, appInfo, host: resolveHost(manifest.id) })
    },
  }))
}

export function createRuntimePluginBootstrap(
  snapshot: PluginStoreSnapshotForLoading,
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
    extensions: snapshot.nativeExtensions.map(({ entry, runtimePath }) => ({
      kind: entry.kind,
      id: entry.id,
      path: runtimePath,
    })),
    skills: snapshot.plugins.flatMap(({ manifest, rootPath }) =>
      (manifest.pi?.skills ?? []).map((path) => resolve(rootPath, path)),
    ),
    prompts: snapshot.plugins.flatMap(({ manifest, rootPath }) =>
      (manifest.pi?.prompts ?? []).map((path) => resolve(rootPath, path)),
    ),
  })
}

export function createRuntimePluginDefinitions(
  bootstrap: RuntimePluginBootstrap,
  emit: RuntimePluginContext['emit'],
): PluginDefinition[] {
  return bootstrap.plugins.map(({ manifest, desiredState, dataPath, runtimeEntryPath }) => ({
    manifest,
    desiredState,
    async createModules() {
      if (!runtimeEntryPath) return []
      const namespace: unknown = await import(pathToFileURL(runtimeEntryPath).toString())
      if (!namespace || typeof namespace !== 'object') {
        throw new Error(`Invalid Runtime Plugin entry: ${manifest.id}`)
      }
      const entrypoint = readPluginEntrypoint<RuntimePluginContext>(
        namespace as Record<string, unknown>,
      )
      return entrypoint({
        process: 'runtime',
        dataPath,
        emit,
        extensions: bootstrap.extensions,
      })
    },
  }))
}
