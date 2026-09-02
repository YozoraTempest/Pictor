import { modelRuntimeProviderContributions } from '../../src/runtime/plugin-interface.js'
import { openAiCompatibleModelProvider } from '../../src/runtime/openai-model-provider.js'
import { defineModule } from '@pictor/plugin-sdk/module'
import { pluginEntrypoint, type RuntimePluginContext } from '@pictor/plugin-sdk/plugin'

export { openAiCompatibleModelProvider }

export default pluginEntrypoint<RuntimePluginContext>(() => [
  defineModule({
    id: 'pictor.model-openai-compatible.runtime',
    activate(context) {
      context.contribute(modelRuntimeProviderContributions, openAiCompatibleModelProvider)
    },
  }),
])
