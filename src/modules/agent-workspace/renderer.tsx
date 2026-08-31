import { defineModule } from '../../kernel/module.js'
import { shellApplicationContributions } from '../shell/application.js'
import { AgentWorkspace } from './AgentWorkspace.js'
import { createAgentWorkspaceClient } from './shared.js'

export const agentWorkspaceRendererModule = defineModule({
  id: 'pictor.agent-workspace.renderer',
  activate(context) {
    const client = createAgentWorkspaceClient(window.pictorModules)
    context.contribute(shellApplicationContributions, {
      id: 'agent-workspace',
      render: ({ settingsSections, rendererPluginStatuses }) => (
        <AgentWorkspace
          client={client}
          settingsSections={settingsSections}
          rendererPluginStatuses={rendererPluginStatuses}
        />
      ),
    })
  },
})
