import { defineModule } from '../../src/kernel/module.js'
import { pluginEntrypoint, type RuntimePluginContext } from '../../src/plugin/entry.js'
import { PiAgentRuntime } from '../../src/runtime/pi-adapter.js'
import { agentRuntimeContributions } from '../../src/runtime/plugin-interface.js'

export default pluginEntrypoint<RuntimePluginContext>((plugin) => [
  defineModule({
    id: 'pictor.pi-agent-runtime.runtime',
    activate(context) {
      const runtime = new PiAgentRuntime(plugin.emit)
      context.contribute(agentRuntimeContributions, runtime)
      context.onDispose({ dispose: () => runtime.dispose() })
    },
  }),
])
