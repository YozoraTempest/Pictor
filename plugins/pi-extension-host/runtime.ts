import { defineModule } from '@pictor/plugin-sdk/module'
import { piExtensionPathContributions } from '@pictor/plugin-sdk/pi-extension'
import { pluginEntrypoint, type RuntimePluginContext } from '@pictor/plugin-sdk/plugin'

export default pluginEntrypoint<RuntimePluginContext>((plugin) => [
  defineModule({
    id: 'pictor.pi-extension-host.runtime',
    activate(context) {
      for (const extension of plugin.extensions) {
        context.contribute(piExtensionPathContributions, extension.path)
      }
    },
  }),
])
