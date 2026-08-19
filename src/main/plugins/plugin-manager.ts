import type { PluginStatus } from '../../plugin/host.js'
import { pluginManagerSnapshotSchema } from '../../shared/plugins.js'
import type { PluginManagerSnapshot } from '../../shared/plugins.js'
import type { PluginStore } from './plugin-store.js'

export class PluginManager {
  private readonly startupStatuses: ReadonlyMap<string, PluginStatus>

  constructor(
    private readonly store: PluginStore,
    statuses: readonly PluginStatus[],
    private readonly safeMode: boolean,
  ) {
    this.startupStatuses = new Map(statuses.map((status) => [status.id, status]))
  }

  async getSnapshot(): Promise<PluginManagerSnapshot> {
    const store = await this.store.getSnapshot()
    const packages = new Map(store.plugins.map((plugin) => [plugin.manifest.id, plugin]))
    let restartRequired = false
    const items = store.registry.entries.map((entry) => {
      if (entry.kind !== 'pictor-plugin') {
        return {
          kind: entry.kind,
          id: entry.id,
          name: entry.id,
          version: entry.kind === 'pi-package' ? entry.version : null,
          source: entry.source,
          desiredState: entry.desiredState,
          effectiveState:
            entry.desiredState === 'disabled' ? ('disabled' as const) : ('blocked' as const),
          reason:
            entry.desiredState === 'disabled'
              ? null
              : 'Native Pi Extension Host has not activated this entry',
          canRestore: false,
        }
      }

      const installed = packages.get(entry.id)
      const startup = this.startupStatuses.get(entry.id)
      const pending =
        (!startup && entry.desiredState !== 'removed') ||
        (startup !== undefined && startup.desiredState !== entry.desiredState)
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
          : (startup?.effectiveState ?? 'disabled'),
        reason: pending ? 'Restart Pictor to apply this change' : (startup?.reason ?? null),
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

  async setEnabled(id: string, enabled: boolean): Promise<PluginManagerSnapshot> {
    await this.store.setEnabled(id, enabled)
    return this.getSnapshot()
  }

  async remove(id: string, deleteData: boolean): Promise<PluginManagerSnapshot> {
    await this.store.remove(id, { deleteData })
    return this.getSnapshot()
  }

  async restoreBundled(id: string): Promise<PluginManagerSnapshot> {
    await this.store.restoreBundled(id)
    return this.getSnapshot()
  }
}
