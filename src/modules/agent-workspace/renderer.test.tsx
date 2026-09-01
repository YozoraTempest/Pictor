import { ModuleKernel } from '../../kernel/kernel.js'
import { guiWorkbenchContributions } from '../../gui/contract.js'
import { createAgentWorkspaceRendererModule } from './renderer.js'

it('contributes the Agent Workspace Workbench through its Renderer Module', async () => {
  Object.defineProperty(window, 'pictorModules', {
    configurable: true,
    value: {
      invoke: vi.fn(),
      onEvent: vi.fn(() => () => undefined),
    },
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

  await kernel.start([createAgentWorkspaceRendererModule('pictor.agent-workspace')])

  expect(kernel.getContributions(guiWorkbenchContributions)).toEqual([
    expect.objectContaining({
      id: 'agent-workspace',
      pluginId: 'pictor.agent-workspace',
      render: expect.any(Function),
    }),
  ])
})
