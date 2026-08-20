import { defineModule } from '../../src/kernel/module.js'
import { pluginEntrypoint, type RuntimePluginContext } from '../../src/plugin/entry.js'
import { modelRuntimeProviderContributions } from '../../src/runtime/plugin-interface.js'
import { openAiCompatibleModelProvider } from '../../src/runtime/openai-model-provider.js'

export { openAiCompatibleModelProvider }

export default pluginEntrypoint<RuntimePluginContext>(() => [
  defineModule({
    id: 'pictor.model-openai-compatible.runtime',
    activate(context) {
      context.contribute(modelRuntimeProviderContributions, openAiCompatibleModelProvider)
    },
  }),
])
