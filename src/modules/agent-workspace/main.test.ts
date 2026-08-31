// @vitest-environment node

import { expect, it, vi } from 'vitest'

import { ModuleRouter, moduleHandlerContributions } from '../../kernel/contract.js'
import { ModuleKernel } from '../../kernel/kernel.js'
import { createAgentWorkspaceMainModule, type AgentWorkspaceMainHost } from './main.js'

const sessionId = '22222222-2222-4222-8222-222222222222'

function unusedAsync() {
  return vi.fn(async () => {
    throw new Error('not used')
  })
}

function unusedSync() {
  return vi.fn(() => {
    throw new Error('not used')
  })
}

function createHost(): AgentWorkspaceMainHost {
  return {
    repository: {
      getSnapshot: vi.fn(async () => ({
        projects: [],
        sessions: [],
        selectedProjectId: null,
        selectedSessionId: null,
        settings: null,
        issues: [],
      })),
      findProjectByPath: unusedAsync(),
      registerProject: unusedAsync(),
      relinkProject: unusedAsync(),
      createSession: unusedAsync(),
      getSession: unusedAsync(),
      inspectSessionHistory: unusedAsync(),
      renameSession: unusedAsync(),
      getSettings: unusedAsync(),
      saveSettings: unusedAsync(),
      getApiKey: vi.fn(async () => null),
    },
    runtime: {
      removeProject: unusedAsync(),
      selectContext: unusedAsync(),
      navigateSessionTree: vi.fn(async () => null),
      compactSession: unusedAsync(),
      labelSessionEntry: unusedAsync(),
      cancelSessionOperation: vi.fn(() => false),
      getSessionRuntimeControls: unusedAsync(),
      setSessionRuntimeControls: unusedAsync(),
      reloadSessionResources: unusedAsync(),
      forkSession: unusedAsync(),
      cloneSession: unusedAsync(),
      importSession: unusedAsync(),
      exportSession: unusedAsync(),
      deleteSession: unusedAsync(),
      start: unusedAsync(),
      stop: unusedSync(),
      respondToExtensionUi: unusedSync(),
      updateComposerText: unusedSync(),
      queueMessage: unusedSync(),
      clearQueue: unusedSync(),
    },
    connectionTester: {
      test: unusedAsync(),
      listModels: unusedAsync(),
    },
  }
}

async function createRouter(host: AgentWorkspaceMainHost): Promise<ModuleRouter> {
  const kernel = new ModuleKernel()
  await kernel.start([createAgentWorkspaceMainModule(host)])
  return new ModuleRouter(kernel.getContributions(moduleHandlerContributions))
}

it('serves workspace state through the Agent Workspace Main Module', async () => {
  const host = createHost()
  const router = await createRouter(host)

  await expect(router.invoke('pictor.agent-workspace', 'getSnapshot', null)).resolves.toMatchObject(
    {
      ok: true,
      value: { projects: [], sessions: [] },
    },
  )
  expect(host.repository.getSnapshot).toHaveBeenCalledOnce()
})

it('passes schema defaults to Runtime operations', async () => {
  const host = createHost()
  const router = await createRouter(host)

  await expect(
    router.invoke('pictor.agent-workspace', 'navigateSessionTree', {
      sessionId,
      entryId: 'entry-1',
    }),
  ).resolves.toEqual({ ok: true, value: null })
  expect(host.runtime.navigateSessionTree).toHaveBeenCalledWith(sessionId, 'entry-1', {
    summarize: false,
    customInstructions: null,
  })
})

it('returns a typed IPC error when model credentials are unavailable', async () => {
  const host = createHost()
  const router = await createRouter(host)

  await expect(
    router.invoke('pictor.agent-workspace', 'listModels', {
      baseUrl: 'https://example.test/v1',
    }),
  ).resolves.toEqual({
    ok: false,
    error: {
      code: 'invalid-input',
      field: 'apiKey',
      message: '请输入 API Key，或先保存一个可用凭据',
    },
  })
})

it('rejects invalid contract input before invoking the host', async () => {
  const host = createHost()
  const router = await createRouter(host)

  await expect(
    router.invoke('pictor.agent-workspace', 'removeProject', { projectId: 'invalid' }),
  ).rejects.toThrow()
  expect(host.runtime.removeProject).not.toHaveBeenCalled()
})
