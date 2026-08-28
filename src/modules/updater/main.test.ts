// @vitest-environment node

import { expect, it, vi } from 'vitest'

import { ModuleRouter, moduleHandlerContributions } from '../../kernel/contract.js'
import { ModuleKernel } from '../../kernel/kernel.js'
import { createUpdaterMainModule } from './main.js'

it('contributes the Updater contract through the Module Kernel', async () => {
  const kernel = new ModuleKernel()
  await kernel.start([
    createUpdaterMainModule({
      currentVersion: '0.2.1',
      platform: 'linux',
      arch: 'x64',
      distribution: 'arch',
      fetch: vi.fn<typeof fetch>(),
      openExternal: vi.fn(async () => undefined),
      getAppInfo: () => ({
        name: 'Pictor',
        version: '0.2.1',
        platform: 'linux',
        arch: 'x64',
        distribution: 'arch',
      }),
    }),
  ])
  const router = new ModuleRouter(kernel.getContributions(moduleHandlerContributions))

  await expect(router.invoke('pictor.updater', 'getAppInfo', null)).resolves.toMatchObject({
    version: '0.2.1',
    distribution: 'arch',
  })
  await kernel.stop()
})
