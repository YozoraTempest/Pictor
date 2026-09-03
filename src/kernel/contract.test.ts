// @vitest-environment node

import { z } from 'zod'
import { expect, it } from 'vitest'

import {
  defineModuleContract as defineSdkModuleContract,
  registerModuleHandlers as registerSdkModuleHandlers,
} from '@pictor/plugin-sdk/contract'
import { ModuleRouter, defineModuleContract, registerModuleHandlers } from './contract.js'

it('routes registered Module methods through their external schemas', async () => {
  const contract = defineModuleContract({
    id: 'example',
    methods: {
      double: { input: z.number().int(), output: z.number().int() },
    },
    events: {},
  })
  const router = new ModuleRouter([
    registerModuleHandlers(contract, { double: async (value) => value * 2 }),
  ])

  await expect(router.invoke('example', 'double', 21)).resolves.toBe(42)
  await expect(router.invoke('example', 'double', '21')).rejects.toThrow()
  await expect(router.invoke('example', 'missing', 21)).rejects.toThrow(
    'Unknown Module method: example.missing',
  )
})

it('routes registrations created by a bundled Plugin SDK copy', async () => {
  const contract = defineSdkModuleContract({
    id: 'portable',
    methods: {
      greet: { input: z.string().min(1), output: z.string().min(1) },
    },
    events: {},
  })
  const router = new ModuleRouter([
    registerSdkModuleHandlers(contract, { greet: (name) => `Hello, ${name}!` }),
  ])

  await expect(router.invoke('portable', 'greet', 'Pictor')).resolves.toBe('Hello, Pictor!')
})
