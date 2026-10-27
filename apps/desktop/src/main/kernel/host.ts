import { Context, type Fiber } from '@deepseek-ai/cordis'
import {
  KERNEL_PREFIX,
  assertKernelDriver,
  type BuiltinKernel,
  type KernelHostServices,
} from '@vulonlok/kernel-sdk'

import type { KernelDriver } from '@vulonlok/kernel-sdk'

/**
 * Publish the engine as its service.
 *
 * The dsh kernel module calls this inside its cordis `apply`: one plugin, one
 * `kernel.<id>` service, which is how the engine reaches the host services it was
 * granted (`pictor.models`, `pictor.rules`, …) and nothing else.
 */
export function provideKernel(ctx: Context, driver: KernelDriver): void {
  assertKernelDriver(driver)
  // A plugin written in plain JavaScript may forget its display name; showing the id is
  // better than showing nothing. Defined on the instance rather than spread, because a
  // class-based driver keeps its methods on the prototype.
  if (typeof driver.label !== 'string' || driver.label.length === 0) {
    Object.defineProperty(driver, 'label', {
      value: driver.id,
      enumerable: true,
      configurable: true,
    })
  }
  ctx.provide(`${KERNEL_PREFIX}${driver.id}`, driver)
}

export interface EngineHostOptions {
  /** What the engine may reach: the model service, the rules, the guard endpoint. */
  services: KernelHostServices
  /**
   * The engine compiled into the app.
   *
   * One entry, not a list: dsh is the engine this app runs, and there is no second one to
   * choose between. An engine that ships separately would be a different product decision
   * than the one this build made.
   */
  builtin: BuiltinKernel
  /**
   * The tree to mount into.
   *
   * Shared with the plugin container so a plugin can `inject` a host service and the
   * engine can read a contribution point — the same relation dsh has on its own side.
   */
  ctx?: Context
}

export interface EngineHost {
  readonly driver: KernelDriver
  dispose(): Promise<void>
}

/**
 * Mount the engine and hand back the driver.
 *
 * The services are provided first, because the kernel module reads them synchronously in
 * `apply`; the module is imported afterwards, so a missing or broken engine fails here
 * with one message instead of half a boot.
 */
export async function startEngine(options: EngineHostOptions): Promise<EngineHost> {
  const ctx = options.ctx ?? new Context()
  // The tree belongs to the caller when one was handed in: disposing it here would take
  // the plugin container's plugins down with the engine.
  const ownsContext = options.ctx === undefined

  let driver: KernelDriver | null = null
  // `internal/service` fires for every published service, which is how the engine appears:
  // nothing enumerates plugins, only what they provided.
  ctx.on('internal/service', (name: string, value: unknown) => {
    if (!name.startsWith(KERNEL_PREFIX)) return
    assertKernelDriver(value)
    driver = value
  })

  ctx.provide('pictor.models', options.services.models)
  ctx.provide('pictor.rules', options.services.rules)
  ctx.provide('pictor.guard', options.services.guard)
  ctx.provide('pictor.permission', options.services.permission)
  ctx.provide('pictor.workspace', options.services.workspace)
  ctx.provide('pictor.userdata', options.services.userData)
  ctx.provide('pictor.settings', options.services.settings)

  const plugin = await options.builtin.entry.load()
  const fiber: Fiber = await ctx.plugin(plugin)

  if (driver === null) {
    await fiber.dispose()
    throw new Error(`${options.builtin.label} 没有提供内核服务：挂载失败`)
  }

  const mounted = driver
  return {
    driver: mounted,
    async dispose(): Promise<void> {
      // A caller's tree outlives this host, so only the fiber is ours to unload.
      await fiber.dispose()
      if (ownsContext) await ctx.fiber.dispose()
    },
  }
}
