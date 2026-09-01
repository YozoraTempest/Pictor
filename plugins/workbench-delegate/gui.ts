import { createElement } from 'react'

import { defineModule } from '../../src/kernel/module.js'
import { guiWorkbenchContributions } from '../../src/gui/contract.js'
import { createAgentWorkspaceClient } from '../../src/modules/agent-workspace/shared.js'
import { pluginEntrypoint, type GuiPluginContext } from '../../src/plugin/entry.js'
import type { GuiWorkbenchContext } from '../../src/gui/contract.js'

import { AgentWorkspace } from './AgentWorkspace.js'
import { installWorkbenchStyles } from './styles.js'

export default pluginEntrypoint<GuiPluginContext>(({ pluginId }) => [
  defineModule({
    id: 'pictor.workbench.delegate.gui',
    activate(context) {
      const client = createAgentWorkspaceClient(window.pictorModules)
      const filePicker = window.pictor
      const releaseStyles = installWorkbenchStyles()
      context.onDispose({ dispose: releaseStyles })
      context.contribute(guiWorkbenchContributions, {
        id: 'delegate',
        pluginId,
        render: (workbenchContext: GuiWorkbenchContext) =>
          createElement(AgentWorkspace, {
            client,
            commandClient: workbenchContext.commandClient,
            filePicker,
            pluginPicker: workbenchContext.pluginPicker,
            settingsSections: workbenchContext.settingsSections,
            guiPluginStatuses: workbenchContext.guiPluginStatuses,
          }),
      })
    },
  }),
])
