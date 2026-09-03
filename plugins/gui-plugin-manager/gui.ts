import { Blocks } from 'lucide-react'
import { createElement } from 'react'

import { guiSettingsSectionContributions } from '../../src/gui/contract.js'
import { defineModule } from '@pictor/plugin-sdk/module'
import { pluginEntrypoint, type GuiPluginContext } from '@pictor/plugin-sdk/plugin'

import { PluginManager } from './PluginManager.js'
import { installPluginManagerStyles } from './styles.js'

export default pluginEntrypoint<GuiPluginContext>(({ pluginId }) => [
  defineModule({
    id: 'pictor.gui.plugin-manager.gui',
    activate(context) {
      const releaseStyles = installPluginManagerStyles()
      context.onDispose({ dispose: releaseStyles })
      context.contribute(guiSettingsSectionContributions, {
        id: 'pictor.gui.plugin-manager.settings',
        owner: pluginId,
        label: 'Plugins',
        icon: Blocks,
        order: 100,
        render: (settingsContext) => createElement(PluginManager, settingsContext),
      })
    },
  }),
])
