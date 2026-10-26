import type { Context } from '@deepseek-ai/cordis'

import { DshDriver } from './dsh-driver.js'
import { hostService, provideKernel, type KernelPlugin } from './host.js'

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
      model: hostService(ctx, 'pictor.models'),
      rules: hostService(ctx, 'pictor.rules'),
      guardEndpoint: hostService(ctx, 'pictor.guard'),
      readPermissionMode: hostService(ctx, 'pictor.permission'),
      resolveCwd: hostService(ctx, 'pictor.workspace'),
      userData: hostService(ctx, 'pictor.userdata'),
    })
    provideKernel(ctx, driver)
  },
}
