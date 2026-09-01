import {
  createAgentWorkspaceHostModule,
  type AgentWorkspaceHost,
} from '../../src/modules/agent-workspace/host.js'
import { pluginEntrypoint, type HostPluginContext } from '../../src/plugin/entry.js'

export default pluginEntrypoint<HostPluginContext<AgentWorkspaceHost>>((context) => [
  createAgentWorkspaceHostModule(context.host),
])
