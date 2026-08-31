import { pluginEntrypoint, type RendererPluginContext } from '../../src/plugin/entry.js'
import { agentWorkspaceRendererModule } from '../../src/modules/agent-workspace/renderer.js'

export default pluginEntrypoint<RendererPluginContext>(() => [agentWorkspaceRendererModule])
