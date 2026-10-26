import type { Context } from '@deepseek-ai/cordis'

import { DshDriver } from './dsh-driver.js'
import { provideKernel, type KernelPlugin } from './host.js'

/**
 * dsh, mounted the way any other kernel is.
 *
 * The driver is untouched; this file is only the wiring. What the driver used to
 * receive as constructor arguments it now reads from the host's services, and the
 * `inject` list below is both the load-order guarantee and the sentence the settings
 * page shows about what this kernel can reach.
 */
export const dshKernel: KernelPlugin = {
  name: 'pictor-kernel-dsh',
  inject: [
    'pictor.models',
    'pictor.rules',
    'pictor.guard',
    'pictor.permission',
    'pictor.workspace',
    'pictor.userdata',
  ],
  apply(ctx: Context): void {
    const driver = new DshDriver({
      model: service(ctx, 'pictor.models'),
      rules: service(ctx, 'pictor.rules'),
      guardEndpoint: service(ctx, 'pictor.guard'),
      readPermissionMode: service(ctx, 'pictor.permission'),
      resolveCwd: service(ctx, 'pictor.workspace'),
      userData: service(ctx, 'pictor.userdata'),
    })
    provideKernel(ctx, driver)
  },
}

/**
 * A host service, which the `inject` declaration already promised exists.
 *
 * Cordis types a lookup as possibly undefined because a service can be unloaded
 * while a plugin is still running; here the fiber only starts once every injected
 * service is available, so a missing one means the host itself is broken.
 */
function service<K extends Parameters<Context['get']>[0] & keyof Context>(
  ctx: Context,
  name: K,
): Context[K] {
  const value = ctx.get(name)
  if (value === undefined) throw new Error(`宿主服务 ${String(name)} 不可用`)
  return value
}
