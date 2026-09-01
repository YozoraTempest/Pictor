// @vitest-environment jsdom

import { expect, it, vi } from 'vitest'

import { guiSettingsSectionContributions } from '../../src/gui/contract.js'
import { ModuleKernel } from '../../src/kernel/kernel.js'
import entrypoint from './gui.js'

it('contributes About through the public GUI contract and releases its stylesheet', async () => {
  Object.defineProperty(window, 'pictorModules', {
    configurable: true,
    value: { invoke: vi.fn(), onEvent: vi.fn(() => () => undefined) },
  })
  const kernel = new ModuleKernel()
  const modules = await entrypoint({ process: 'gui', pluginId: 'pictor.updater' })

  await kernel.start(modules)
  expect(kernel.getContributions(guiSettingsSectionContributions)).toEqual([
    expect.objectContaining({
      id: 'pictor.updater.about',
      owner: 'pictor.updater',
      render: expect.any(Function),
    }),
  ])
  expect(document.head.querySelector('style[data-pictor-plugin="pictor.updater"]')).not.toBeNull()

  await kernel.stop()
  expect(document.head.querySelector('style[data-pictor-plugin="pictor.updater"]')).toBeNull()
})
