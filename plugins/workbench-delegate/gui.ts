import { createElement } from 'react'

import { guiWorkbenchContributions } from '../../src/gui/contract.js'
import { createAgentWorkspaceClient } from '../../src/modules/agent-workspace/shared.js'
import type { GuiWorkbenchContext } from '../../src/gui/contract.js'
import { defineModule } from '@pictor/plugin-sdk/module'
import { pluginEntrypoint, type GuiPluginContext } from '@pictor/plugin-sdk/plugin'

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
            filePicker,
            settingsSections: workbenchContext.settingsSections,
            settingsContext: workbenchContext,
          }),
      })
    },
  }),
])
