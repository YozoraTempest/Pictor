import { ModuleKernel } from '../../kernel/kernel.js'
import { shellApplicationContributions } from '../shell/application.js'
import { agentWorkspaceRendererModule } from './renderer.js'

it('contributes the Agent Workspace application through its Renderer Module', async () => {
  const kernel = new ModuleKernel()

  await kernel.start([agentWorkspaceRendererModule])

  expect(kernel.getContributions(shellApplicationContributions)).toEqual([
    expect.objectContaining({ id: 'agent-workspace', render: expect.any(Function) }),
  ])
})
