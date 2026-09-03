// @vitest-environment jsdom

import { expect, it, vi } from 'vitest'

import { ModuleKernel } from '../../src/kernel/kernel.js'
import { guiSettingsSectionContributions } from '../../src/gui/contract.js'
import entrypoint from './gui.js'

it('contributes its settings page and releases its owned stylesheet', async () => {
  const kernel = new ModuleKernel()
  const modules = await entrypoint({ process: 'gui', pluginId: 'pictor.gui.plugin-manager' })

  await kernel.start(modules)
  expect(kernel.getContributions(guiSettingsSectionContributions)).toEqual([
    expect.objectContaining({
      id: 'pictor.gui.plugin-manager.settings',
      owner: 'pictor.gui.plugin-manager',
      render: expect.any(Function),
    }),
  ])
  expect(
    document.head.querySelector('style[data-pictor-plugin="pictor.gui.plugin-manager"]'),
  ).not.toBeNull()

  await kernel.stop()
  expect(kernel.getContributions(guiSettingsSectionContributions)).toEqual([])
  expect(
    document.head.querySelector('style[data-pictor-plugin="pictor.gui.plugin-manager"]'),
  ).toBeNull()
  vi.restoreAllMocks()
})
