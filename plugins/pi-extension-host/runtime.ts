import { defineModule } from '../../src/kernel/module.js'
import { pluginEntrypoint, type RuntimePluginContext } from '../../src/plugin/entry.js'
import { piExtensionPathContributions } from '../../src/runtime/plugin-interface.js'

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
