// @vitest-environment jsdom

import { expect, it, vi } from 'vitest'

import { ModuleKernel } from '../../src/kernel/kernel.js'
import { guiWorkbenchContributions } from '../../src/gui/contract.js'
import entrypoint from './gui.js'
import { installWorkbenchStyles } from './styles.js'

it('contributes the Delegate Workbench through the public GUI contract', async () => {
  Object.defineProperty(window, 'pictorModules', {
    configurable: true,
    value: { invoke: vi.fn(), onEvent: vi.fn(() => () => undefined) },
  })
  Object.defineProperty(window, 'pictor', {
    configurable: true,
    value: {
      pickProjectDirectory: vi.fn(),
      pickSessionImport: vi.fn(),
      pickSessionExport: vi.fn(),
      pickMessageImages: vi.fn(),
    },
  })
  const kernel = new ModuleKernel()
  const modules = await entrypoint({ process: 'gui', pluginId: 'pictor.workbench.delegate' })

  await kernel.start(modules)
  expect(kernel.getContributions(guiWorkbenchContributions)).toEqual([
    expect.objectContaining({
      id: 'delegate',
      pluginId: 'pictor.workbench.delegate',
      render: expect.any(Function),
    }),
  ])
  await kernel.stop()
  expect(
    document.head.querySelector('style[data-pictor-plugin="pictor.workbench.delegate"]'),
  ).toBeNull()
})

it('owns GUI styles by installing and releasing one style element', () => {
  const release = installWorkbenchStyles(document)
  const style = document.head.querySelector('style[data-pictor-plugin="pictor.workbench.delegate"]')
  expect(style).not.toBeNull()

  release()
  expect(
    document.head.querySelector('style[data-pictor-plugin="pictor.workbench.delegate"]'),
  ).toBeNull()
})
