import { defineModule } from '../../kernel/module.js'
import { shellApplicationContributions } from '../shell/application.js'
import { AgentWorkspace } from './AgentWorkspace.js'

export const agentWorkspaceRendererModule = defineModule({
  id: 'pictor.agent-workspace.renderer',
  activate(context) {
    context.contribute(shellApplicationContributions, {
      id: 'agent-workspace',
      render: ({ settingsSections, rendererPluginStatuses }) => (
        <AgentWorkspace
          settingsSections={settingsSections}
          rendererPluginStatuses={rendererPluginStatuses}
        />
      ),
    })
  },
})
