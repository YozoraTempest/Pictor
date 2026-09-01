import { pluginEntrypoint, type RendererPluginContext } from '../../src/plugin/entry.js'
import { createAgentWorkspaceRendererModule } from '../../src/modules/agent-workspace/renderer.js'

export default pluginEntrypoint<RendererPluginContext>(({ pluginId }) => [
  createAgentWorkspaceRendererModule(pluginId),
])
