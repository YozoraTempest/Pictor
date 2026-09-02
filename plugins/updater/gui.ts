import { Info } from 'lucide-react'
import { createElement } from 'react'

import { guiSettingsSectionContributions } from '../../src/gui/contract.js'
import { createUpdaterClient } from '../../src/modules/updater/shared.js'
import { defineModule } from '@pictor/plugin-sdk/module'
import { pluginEntrypoint, type GuiPluginContext } from '@pictor/plugin-sdk/plugin'

import { AboutSettings } from './AboutSettings.js'
import { installUpdaterStyles } from './styles.js'

export default pluginEntrypoint<GuiPluginContext>(({ pluginId }) => [
  defineModule({
    id: 'pictor.updater.gui',
    activate(context) {
      const client = createUpdaterClient(window.pictorModules)
      const releaseStyles = installUpdaterStyles()
      context.onDispose({ dispose: releaseStyles })
      context.contribute(guiSettingsSectionContributions, {
        id: 'pictor.updater.about',
        owner: pluginId,
        label: '关于',
        icon: Info,
        order: 300,
        render: () => createElement(AboutSettings, { client }),
      })
    },
  }),
])
