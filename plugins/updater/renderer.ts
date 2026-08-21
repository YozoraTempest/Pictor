import { updaterRendererModule } from '../../src/modules/updater/renderer.js'
import { pluginEntrypoint, type RendererPluginContext } from '../../src/plugin/entry.js'

export default pluginEntrypoint<RendererPluginContext>(() => [updaterRendererModule])
