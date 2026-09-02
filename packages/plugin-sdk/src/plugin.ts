import type { PictorModule } from './module.js'

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

export interface RuntimePluginContext<TRuntimeEvent = never> {
  process: 'runtime'
  dataPath: string
  emit(event: TRuntimeEvent): void
  extensions: readonly {
    kind: 'pi-extension' | 'pi-package'
    id: string
    path: string
  }[]
}

export type PluginEntrypoint<TContext> = (
  context: TContext,
) => readonly PictorModule[] | Promise<readonly PictorModule[]>

export function pluginEntrypoint<TContext>(
  entrypoint: PluginEntrypoint<TContext>,
): PluginEntrypoint<TContext> {
  return entrypoint
}
