import {
  createAgentWorkspaceMainModule,
  type AgentWorkspaceMainHost,
} from '../../src/modules/agent-workspace/main.js'
import { pluginEntrypoint, type MainPluginContext } from '../../src/plugin/entry.js'

export default pluginEntrypoint<MainPluginContext<AgentWorkspaceMainHost>>((context) => [
  createAgentWorkspaceMainModule(context.host),
])
