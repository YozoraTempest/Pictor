import type { PluginStatus } from '../../plugin/host.js'
import type { InstalledExtension, PluginDesiredState } from '../../plugin/registry.js'
import { pluginManagerSnapshotSchema } from '../../shared/plugins.js'
import type { PluginManagerSnapshot } from '../../shared/plugins.js'
import type { PluginStore } from './plugin-store.js'

export class PluginManager {
  private readonly startupStatuses: ReadonlyMap<string, PluginStatus>
  private readonly startupDesiredStates: ReadonlyMap<string, PluginDesiredState>

  constructor(
    private readonly store: PluginStore,
    statuses: readonly PluginStatus[],
    private readonly safeMode: boolean,
    startupEntries: readonly InstalledExtension[],
    private readonly activationMode: 'full' | 'headless' = 'full',
  ) {
    this.startupStatuses = new Map(statuses.map((status) => [status.id, status]))
    this.startupDesiredStates = new Map(
      startupEntries.map((entry) => [`${entry.kind}:${entry.id}`, entry.desiredState]),
    )
  }

  async getSnapshot(): Promise<PluginManagerSnapshot> {
    const store = await this.store.getSnapshot()
    const packages = new Map(store.plugins.map((plugin) => [plugin.manifest.id, plugin]))
    let restartRequired = false
    const items = store.registry.entries.map((entry) => {
      if (entry.kind !== 'pictor-plugin') {
        const startupDesired = this.startupDesiredStates.get(`${entry.kind}:${entry.id}`)
        const pending = startupDesired === undefined || startupDesired !== entry.desiredState
        restartRequired ||= pending
        const extensionHostActive =
          this.startupStatuses.get('pictor.pi-extension-host')?.effectiveState === 'active'
        return {
          kind: entry.kind,
          id: entry.id,
          name: entry.id,
          version: entry.kind === 'pi-package' ? entry.version : null,
          source: entry.source,
          desiredState: entry.desiredState,
          effectiveState: pending
            ? ('pending-restart' as const)
            : entry.desiredState !== 'enabled'
              ? ('disabled' as const)
              : extensionHostActive
                ? ('active' as const)
                : ('blocked' as const),
          reason: pending
            ? 'Restart Pictor to apply this change'
            : entry.desiredState === 'enabled' && !extensionHostActive
              ? 'Pi Extension Host is unavailable'
              : null,
          canRestore: false,
        }
      }

      const installed = packages.get(entry.id)
      const startup = this.startupStatuses.get(entry.id)
      const pending = this.isPending(entry, startup)
      restartRequired ||= pending
      return {
        kind: entry.kind,
        id: entry.id,
        name: installed?.manifest.name ?? entry.id,
        version: entry.version,
        source: `${entry.source.kind}:${entry.source.reference}`,
        desiredState: entry.desiredState,
        effectiveState: pending
          ? ('pending-restart' as const)
          : this.safeMode && entry.desiredState === 'enabled'
            ? ('disabled' as const)
            : this.activationMode === 'headless' && entry.desiredState === 'enabled'
              ? ('blocked' as const)
              : (startup?.effectiveState ?? 'disabled'),
        reason: pending
          ? 'Restart Pictor to apply this change'
          : this.safeMode && entry.desiredState === 'enabled'
            ? 'Safe mode ignores all Plugins'
            : this.activationMode === 'headless' && entry.desiredState === 'enabled'
              ? 'CLI does not load GUI Plugin Modules'
              : (startup?.reason ?? null),
        canRestore: entry.source.kind === 'bundled' && entry.desiredState === 'removed',
      }
    })

    return pluginManagerSnapshotSchema.parse({
      safeMode: this.safeMode,
      restartRequired,
      items,
      issues: store.issues.map((issue) => `${issue.source}: ${issue.message}`),
    })
  }

  async installLocal(path: string): Promise<PluginManagerSnapshot> {
    await this.store.installFromDirectory(path)
    return this.getSnapshot()
  }

  async installDevelopment(path: string): Promise<PluginManagerSnapshot> {
    await this.store.installDevelopmentFromDirectory(path)
    return this.getSnapshot()
  }

  async installPiExtension(path: string): Promise<PluginManagerSnapshot> {
    await this.store.installPiExtension(path)
    return this.getSnapshot()
  }

  async installPiPackage(path: string): Promise<PluginManagerSnapshot> {
    await this.store.installPiPackage(path)
    return this.getSnapshot()
  }

  async installPiPackageSpec(spec: string): Promise<PluginManagerSnapshot> {
    await this.store.installPiPackageFromSpec(spec)
    return this.getSnapshot()
  }

  async setEnabled(
    kind: 'pictor-plugin' | 'pi-extension' | 'pi-package',
    id: string,
    enabled: boolean,
  ): Promise<PluginManagerSnapshot> {
    if (kind === 'pictor-plugin') await this.store.setEnabled(id, enabled)
    else await this.store.setNativeExtensionEnabled(kind, id, enabled)
    return this.getSnapshot()
  }

  async remove(
    kind: 'pictor-plugin' | 'pi-extension' | 'pi-package',
    id: string,
    deleteData: boolean,
  ): Promise<PluginManagerSnapshot> {
    if (kind === 'pictor-plugin') await this.store.remove(id, { deleteData })
    else await this.store.removeNativeExtension(kind, id)
    return this.getSnapshot()
  }

  async restoreBundled(id: string): Promise<PluginManagerSnapshot> {
    await this.store.restoreBundled(id)
    return this.getSnapshot()
  }

  private isPending(entry: InstalledExtension, startup: PluginStatus | undefined): boolean {
    if (this.activationMode === 'headless') {
      const initialDesired = this.startupDesiredStates.get(`${entry.kind}:${entry.id}`)
      return initialDesired === undefined
        ? entry.desiredState !== 'removed'
        : initialDesired !== entry.desiredState
    }
    return (
      (!startup && entry.desiredState !== 'removed') ||
      (startup !== undefined && startup.desiredState !== entry.desiredState)
    )
  }
}
