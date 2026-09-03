import type { PictorModule } from '../kernel/module.js'
import type { RuntimeEvent } from '../shared/runtime-protocol.js'

export interface HostPluginContext<THost = unknown> {
  process: 'host'
  dataPath: string
  appInfo: unknown
  host: THost
}

export interface GuiPluginContext {
  process: 'gui'
  pluginId: string
}

export interface TuiPluginContext {
  process: 'tui'
  pluginId: string
}

export interface RuntimePluginContext {
  process: 'runtime'
  dataPath: string
  emit(event: RuntimeEvent): void
  extensions: readonly {
    kind: 'pi-extension' | 'pi-package'
    id: string
    path: string
  }[]
}

export type PluginProcessContext =
  HostPluginContext | GuiPluginContext | TuiPluginContext | RuntimePluginContext

export type PluginEntrypoint<TContext extends PluginProcessContext = PluginProcessContext> = (
  context: TContext,
) => readonly PictorModule[] | Promise<readonly PictorModule[]>

export function pluginEntrypoint<TContext extends PluginProcessContext>(
  entrypoint: PluginEntrypoint<TContext>,
): PluginEntrypoint<TContext> {
  return entrypoint
}

export function readPluginEntrypoint<TContext extends PluginProcessContext>(
  namespace: Record<string, unknown>,
): PluginEntrypoint<TContext> {
  if (typeof namespace.default !== 'function') {
    throw new Error('Plugin process entry must export a default factory function')
  }
  return namespace.default as PluginEntrypoint<TContext>
}
