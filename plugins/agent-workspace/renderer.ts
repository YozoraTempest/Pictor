import { pluginEntrypoint, type RendererPluginContext } from '../../src/plugin/entry.js'
import { defineModule } from '../../src/kernel/module.js'
import { shellApplicationContributions } from '../../src/modules/shell/application.js'
import { App } from '../../src/renderer/App.js'
import { createElement } from 'react'

export default pluginEntrypoint<RendererPluginContext>(() => [
  defineModule({
    id: 'pictor.agent-workspace.renderer',
    activate(context) {
      context.contribute(shellApplicationContributions, {
        id: 'agent-workspace',
        render: ({ settingsSections, rendererPluginStatuses }) =>
          createElement(App, { settingsSections, rendererPluginStatuses }),
      })
    },
  }),
])
