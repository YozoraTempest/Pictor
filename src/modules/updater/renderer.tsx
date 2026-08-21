import { Info } from 'lucide-react'

import { Token, defineModule } from '../../kernel/module.js'
import { settingsSectionContributions } from '../shell/settings.js'
import { AboutSettings } from './AboutSettings.js'
import { createUpdaterClient, type UpdaterClient } from './shared.js'

export const updaterClientToken = new Token<UpdaterClient>('updater.client')

export const updaterRendererModule = defineModule({
  id: 'updater.renderer',
  provides: updaterClientToken,
  activate(context) {
    const client = createUpdaterClient(window.pictorModules)
    context.contribute(settingsSectionContributions, {
      id: 'pictor.updater.about',
      label: '关于',
      icon: Info,
      render: () => <AboutSettings client={client} />,
    })
    return client
  },
})
