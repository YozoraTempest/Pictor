// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import {
  defineModuleContract,
  invokeModuleMethod,
  moduleHandlerContributions,
  registerModuleHandlers,
  type ModuleTransport,
} from './contract.js'
import { definePluginManifest } from './manifest.js'
import { ContributionPoint, Token, defineModule } from './module.js'
import { piExtensionPathContributions } from './pi-extension.js'
import { pluginEntrypoint, type HostPluginContext } from './plugin.js'

describe('@pictor/plugin-sdk', () => {
  it('defines portable Modules through stable capability and contribution IDs', () => {
    const capability = new Token<number>('example.capability')
    const contributions = new ContributionPoint<string>('example.contributions')
    const module = defineModule({
      id: 'example.module',
      requires: [capability] as const,
      activate(context, value) {
        context.contribute(contributions, `value ${value}`)
      },
    })

    expect(module).toMatchObject({
      id: 'example.module',
      requires: [{ id: 'example.capability' }],
    })
    expect(contributions.id).toBe('example.contributions')
  })

  it('validates Module calls on both sides of the transport seam', async () => {
    const contract = defineModuleContract({
      id: 'example.contract',
      methods: {
        double: { input: z.number().int(), output: z.number().int() },
      },
      events: {},
    })
    const handler = registerModuleHandlers(contract, { double: (value) => value * 2 })
    const transport: ModuleTransport = {
      invoke: vi.fn(async (_moduleId, method, input) => {
        if (method !== 'double') throw new Error('Unexpected method')
        return handler.handlers.double?.(input)
      }),
      onEvent: vi.fn(() => () => undefined),
    }

    await expect(invokeModuleMethod(transport, contract, 'double', 21)).resolves.toBe(42)
    await expect(invokeModuleMethod(transport, contract, 'double', 21.5)).rejects.toThrow()
    expect(moduleHandlerContributions.id).toBe('kernel.module-handlers')
  })

  it('defines Plugin entrypoints and validates Manifest metadata', async () => {
    const entrypoint = pluginEntrypoint<HostPluginContext>(({ dataPath }) => [
      defineModule({ id: `example.host:${dataPath}`, activate() {} }),
    ])
    const manifest = definePluginManifest({
      id: 'example.plugin',
      name: 'Example Plugin',
      version: '0.4.0',
      engines: { pictor: '^0.4.0' },
      dependencies: {},
      modules: { host: './dist/host.js' },
    })

    await expect(
      Promise.resolve(
        entrypoint({ process: 'host', dataPath: '/plugin-data', appInfo: null, host: null }),
      ),
    ).resolves.toEqual([expect.objectContaining({ id: 'example.host:/plugin-data' })])
    expect(manifest.id).toBe('example.plugin')
    expect(piExtensionPathContributions.id).toBe('pi.extension-paths')
  })
})
