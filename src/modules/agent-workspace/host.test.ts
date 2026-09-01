// @vitest-environment node

import { expect, it, vi } from 'vitest'

import { ModuleRouter, moduleHandlerContributions } from '../../kernel/contract.js'
import { ModuleKernel } from '../../kernel/kernel.js'
import { createAgentWorkspaceHostModule, type AgentWorkspaceHost } from './host.js'

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

function createHost(): AgentWorkspaceHost {
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

async function createRouter(host: AgentWorkspaceHost): Promise<ModuleRouter> {
  const kernel = new ModuleKernel()
  await kernel.start([createAgentWorkspaceHostModule(host)])
  return new ModuleRouter(kernel.getContributions(moduleHandlerContributions))
}

it('serves workspace state through the Agent Workspace Host Module', async () => {
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

it('inspects an explicit project path without opening a GUI picker', async () => {
  const host = createHost()
  host.repository.findProjectByPath = vi.fn(async () => null)
  const router = await createRouter(host)

  await expect(
    router.invoke('pictor.agent-workspace', 'inspectProjectPath', {
      rootPath: '/workspace/Pictor',
    }),
  ).resolves.toEqual({
    ok: true,
    value: {
      name: 'Pictor',
      rootPath: '/workspace/Pictor',
      existingProjectId: null,
    },
  })
  expect(host.repository.findProjectByPath).toHaveBeenCalledWith('/workspace/Pictor')
})

it('passes explicit Session transfer paths through the pure Node module', async () => {
  const host = createHost()
  const importSession = vi.fn(async () => null)
  const exportSession = vi.fn(async () => undefined)
  host.runtime.importSession = importSession
  host.runtime.exportSession = exportSession
  const router = await createRouter(host)

  await expect(
    router.invoke('pictor.agent-workspace', 'importSession', {
      projectId: '11111111-1111-4111-8111-111111111111',
      sourcePath: '/imports/history.jsonl',
    }),
  ).resolves.toEqual({ ok: true, value: null })
  expect(importSession).toHaveBeenCalledWith(
    '11111111-1111-4111-8111-111111111111',
    '/imports/history.jsonl',
  )

  await expect(
    router.invoke('pictor.agent-workspace', 'exportSession', {
      sessionId,
      format: 'html',
      destinationPath: '/exports/history.html',
    }),
  ).resolves.toEqual({ ok: true, value: true })
  expect(exportSession).toHaveBeenCalledWith(sessionId, 'html', '/exports/history.html')
})

it('rejects unsafe Session transfer paths before invoking Runtime', async () => {
  const host = createHost()
  const importSession = vi.fn(async () => null)
  const exportSession = vi.fn(async () => undefined)
  host.runtime.importSession = importSession
  host.runtime.exportSession = exportSession
  const router = await createRouter(host)

  await expect(
    router.invoke('pictor.agent-workspace', 'importSession', {
      projectId: '11111111-1111-4111-8111-111111111111',
      sourcePath: 'relative/history.jsonl',
    }),
  ).resolves.toMatchObject({ ok: false, error: { code: 'invalid-input' } })
  await expect(
    router.invoke('pictor.agent-workspace', 'exportSession', {
      sessionId,
      format: 'jsonl',
      destinationPath: '/exports/history.txt',
    }),
  ).resolves.toMatchObject({ ok: false, error: { code: 'invalid-input' } })
  expect(importSession).not.toHaveBeenCalled()
  expect(exportSession).not.toHaveBeenCalled()
})
