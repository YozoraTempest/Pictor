import { defineModule } from '../../kernel/module.js'
import { shellApplicationContributions } from '../shell/application.js'
import { AgentWorkspace } from './AgentWorkspace.js'
import { createAgentWorkspaceClient, type AgentWorkspaceFilePicker } from './shared.js'

export const agentWorkspaceRendererModule = defineModule({
  id: 'pictor.agent-workspace.renderer',
  activate(context) {
    const client = createAgentWorkspaceClient(window.pictorModules)
    const filePicker: AgentWorkspaceFilePicker = window.pictor
    context.contribute(shellApplicationContributions, {
      id: 'agent-workspace',
      render: ({ settingsSections, rendererPluginStatuses }) => (
        <AgentWorkspace
          client={client}
          filePicker={filePicker}
          settingsSections={settingsSections}
          rendererPluginStatuses={rendererPluginStatuses}
        />
      ),
    })
  },
})
