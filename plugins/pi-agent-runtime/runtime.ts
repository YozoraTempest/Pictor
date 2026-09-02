import { PiAgentRuntime } from '../../src/runtime/pi-adapter.js'
import { agentRuntimeContributions } from '../../src/runtime/plugin-interface.js'
import type { RuntimeEvent } from '../../src/shared/runtime-protocol.js'
import { defineModule } from '@pictor/plugin-sdk/module'
import { pluginEntrypoint, type RuntimePluginContext } from '@pictor/plugin-sdk/plugin'

export default pluginEntrypoint<RuntimePluginContext<RuntimeEvent>>((plugin) => [
  defineModule({
    id: 'pictor.pi-agent-runtime.runtime',
    activate(context) {
      const runtime = new PiAgentRuntime(plugin.emit)
      context.contribute(agentRuntimeContributions, runtime)
      context.onDispose({ dispose: () => runtime.dispose() })
    },
  }),
])
