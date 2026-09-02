import {
  createAgentWorkspaceHostModule,
  type AgentWorkspaceHost,
} from '../../src/modules/agent-workspace/host.js'
import { pluginEntrypoint, type HostPluginContext } from '@pictor/plugin-sdk/plugin'

export default pluginEntrypoint<HostPluginContext<AgentWorkspaceHost>>((context) => [
  createAgentWorkspaceHostModule(context.host),
])
