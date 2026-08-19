import type { PictorModule } from '../kernel/module.js'
import type { RuntimeEvent } from '../shared/runtime-protocol.js'

export interface MainPluginContext {
  process: 'main'
  dataPath: string
  appInfo: unknown
}

export interface RendererPluginContext {
  process: 'renderer'
  pluginId: string
}

export interface RuntimePluginContext {
  process: 'runtime'
  dataPath: string
  emit(event: RuntimeEvent): void
}

export type PluginProcessContext = MainPluginContext | RendererPluginContext | RuntimePluginContext

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
