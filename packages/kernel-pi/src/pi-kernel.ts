import type { Context } from '@deepseek-ai/cordis'

import { parseMcpServers, piProvidersOf, type PiProviderSpec } from '@vulonlok/shared'

import type { KernelModelService } from '@vulonlok/kernel-sdk'
import { writeGuardExtension } from './pi-guard-extension.js'
import { hostService, provideKernel, type KernelPlugin } from '@vulonlok/kernel-sdk'
import { forgetForeignPiModels } from './pi-home.js'
import { PI_OWN_CONFIG_KEY, PiRpcDriver } from './pi-rpc-driver.js'

/**
 * Pi, mounted the way any other kernel is.
 *
 * Pi is a child process per conversation, so nothing here changes how it runs: the
 * plugin exists to take its dependencies from the host instead of from the file that
 * assembles the app, which is what lets the settings page say what it can reach.
 *
 * One thing it owns rather than reads is whether Pi runs on Pictor's configuration or
 * its own. That is Pi's setting, so Pi is the one that reads it at mount, remembers it
 * while the driver is alive, and persists it back — the app that assembles the two
 * never names the key.
 */
export function createPiKernel(): KernelPlugin {
  return {
    name: 'pictor-kernel-pi',
    // A model catalogue, a stored setting, an RPC endpoint and a guard extension: all
    // it needs from Pictor, and all the settings page reports it can reach.
    inject: [
      'pictor.models',
      'pictor.userdata',
      'pictor.workspace',
      'pictor.guard',
      'pictor.settings',
    ],
    apply(ctx: Context): void {
      const userData = hostService(ctx, 'pictor.userdata')
      const settings = hostService(ctx, 'pictor.settings')
      let ownConfig = settings.read(PI_OWN_CONFIG_KEY) === true
      // Starting on Pictor's configuration means any remembered choice of one of Pi's
      // own models is unusable here; forgetting it now beats failing the first turn.
      if (!ownConfig) forgetForeignPiModels(userData)

      const providers = providersOf(hostService(ctx, 'pictor.models'))
      provideKernel(
        ctx,
        new PiRpcDriver({
          userData,
          resolveCwd: hostService(ctx, 'pictor.workspace'),
          providers,
          setOwnConfig: async (value: boolean) => {
            ownConfig = value
            await settings.write(PI_OWN_CONFIG_KEY, value)
            if (!value) forgetForeignPiModels(userData)
          },
          // The same guard chain dsh asks over loopback, written as a Pi extension: a
          // user's tool rules mean the same thing on both kernels. The endpoint is read
          // per launch, and a missing one makes the extension block rather than allow.
          guardExtension: () => writeGuardExtension(userData, hostService(ctx, 'pictor.guard')()),
          ownConfig: () => ownConfig,
          // Pi reads `mcp.json` per spawn; the driver writes it from this list.
          mcpServers: () => parseMcpServers(settings.read('mcp.servers')),
        }),
      )
    },
  }
}

/** Pictor's services, in the shape Pi's provider registration takes. */
function providersOf(model: KernelModelService): () => Promise<PiProviderSpec[]> {
  return async () => {
    const list = await model.providers()
    const settings = await model.settings()
    return piProvidersOf(list.providers, (id) => model.apiKeyOf(id), {
      providerId: list.activeId,
      modelId: settings.modelId,
    }).providers
  }
}
