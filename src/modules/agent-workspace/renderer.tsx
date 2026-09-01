import { defineModule } from '../../kernel/module.js'
import { guiWorkbenchContributions } from '../../gui/contract.js'
import { AgentWorkspace } from './AgentWorkspace.js'
import { createAgentWorkspaceClient, type AgentWorkspaceFilePicker } from './shared.js'

export function createAgentWorkspaceRendererModule(pluginId: string) {
  return defineModule({
    id: 'pictor.agent-workspace.renderer',
    activate(context) {
      const client = createAgentWorkspaceClient(window.pictorModules)
      const filePicker: AgentWorkspaceFilePicker = window.pictor
      context.contribute(guiWorkbenchContributions, {
        id: 'agent-workspace',
        pluginId,
        render: ({ commandClient, pluginPicker, settingsSections, rendererPluginStatuses }) => (
          <AgentWorkspace
            client={client}
            commandClient={commandClient}
            filePicker={filePicker}
            pluginPicker={pluginPicker}
            settingsSections={settingsSections}
            rendererPluginStatuses={rendererPluginStatuses}
          />
        ),
      })
    },
  })
}
