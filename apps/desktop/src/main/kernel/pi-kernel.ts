import type { Context } from '@deepseek-ai/cordis'

import { piProvidersOf, type PiProviderSpec } from '@pictor/shared'

import type { ModelService } from '../model-service.js'
import { writeGuardExtension } from '../pi-guard-extension.js'
import { hostService, provideKernel, type KernelPlugin } from './host.js'
import { PiRpcDriver } from './pi-rpc-driver.js'

/**
 * Pi, mounted the way any other kernel is.
 *
 * Pi is a child process per conversation, so nothing here changes how it runs: the
 * plugin exists to take its dependencies from the host instead of from the file that
 * assembles the app, which is what lets the settings page say what it can reach.
 *
 * One thing it owns rather than reads is whether Pi runs on Pictor's configuration
 * or its own. That switch is flipped from the settings page while the driver is
 * already alive, and the driver reads it on the next spawn, so the value lives in
 * this closure and the caller writes through {@link PiKernel.setOwnConfig}.
 */
export interface PiKernel {
  plugin: KernelPlugin
  /**
   * The mounted driver, or null before the host mounts the plugin.
   *
   * Everything else about Pi — its settings, its catalogue, the services it runs
   * with — is reached through the driver's interfaces, so nothing outside this file
   * has to know the type.
   */
  driver: () => PiRpcDriver | null
}

/** Pictor's services, in the shape Pi's provider registration takes. */
function providersOf(model: ModelService): () => Promise<PiProviderSpec[]> {
  return async () => {
    const list = await model.providers()
    const settings = await model.settings()
    return piProvidersOf(list.providers, (id) => model.apiKeyOf(id), {
      providerId: list.activeId,
      modelId: settings.modelId,
    }).providers
  }
}

export function createPiKernel(options: { ownConfig: boolean }): PiKernel {
  let ownConfig = options.ownConfig
  let instance: PiRpcDriver | null = null
  let providers: (() => Promise<PiProviderSpec[]>) | null = null

  const plugin: KernelPlugin = {
    name: 'pictor-kernel-pi',
    // A model catalogue, an RPC endpoint and a guard extension: all it needs from
    // Pictor, and all the settings page reports it can reach.
    inject: ['pictor.models', 'pictor.userdata', 'pictor.workspace', 'pictor.guard'],
    apply(ctx: Context): void {
      const userData = hostService(ctx, 'pictor.userdata')
      providers = providersOf(hostService(ctx, 'pictor.models'))
      instance = new PiRpcDriver({
        userData,
        resolveCwd: hostService(ctx, 'pictor.workspace'),
        providers: () => (providers === null ? Promise.resolve([]) : providers()),
        setOwnConfig: (value: boolean) => {
          ownConfig = value
        },
        // The same guard chain dsh asks over loopback, written as a Pi extension: a
        // user's tool rules mean the same thing on both kernels. The endpoint is read
        // per launch, and a missing one makes the extension block rather than allow.
        guardExtension: () => writeGuardExtension(userData, hostService(ctx, 'pictor.guard')()),
        ownConfig: () => ownConfig,
      })
      provideKernel(ctx, instance)
    },
  }

  return { plugin, driver: () => instance }
}
