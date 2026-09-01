// @vitest-environment node

import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, it } from 'vitest'

import { CommandEngine } from '../commands/engine.js'
import { ModuleRouter, moduleHandlerContributions } from '../kernel/contract.js'
import { ModuleKernel } from '../kernel/kernel.js'
import { createAgentWorkspaceHostModule } from '../modules/agent-workspace/host.js'
import { createAgentWorkspaceClient } from '../modules/agent-workspace/shared.js'
import { ModelConnectionTester } from '../application/index.js'
import { AppRepository } from '../main/persistence/app-repository.js'
import { SecretStore } from '../main/persistence/secret-store.js'
import { RuntimeCoordinator } from '../main/runtime/coordinator.js'
import type { RuntimeHost } from '../application/ports.js'
import type {
  RuntimeCompactConfig,
  RuntimeCompactResult,
  RuntimeEvent,
  RuntimeExportConfig,
  RuntimeExportResult,
  RuntimeForkConfig,
  RuntimeForkResult,
  RuntimeImportConfig,
  RuntimeImportResult,
  RuntimeLabelConfig,
  RuntimeLabelResult,
  RuntimeNavigateConfig,
  RuntimeNavigateResult,
  RuntimeSessionOpenConfig,
  RuntimeStartConfig,
} from '../shared/runtime-protocol.js'
import { tuiApplicationContributions, type TuiApplicationContext } from './contract.js'
import entrypoint from '../../plugins/tui-delegate/tui.js'

const now = '2026-09-02T00:00:00.000Z'

class NoopRuntimeHost implements RuntimeHost {
  readonly events: RuntimeEvent[] = []

  async openSession(_config: RuntimeSessionOpenConfig): Promise<void> {}

  async closeSession(): Promise<void> {}

  async start(_config: RuntimeStartConfig): Promise<void> {}

  async fork(config: RuntimeForkConfig): Promise<RuntimeForkResult> {
    return {
      type: 'host.forkResult',
      operationId: config.operationId,
      targetSessionId: config.targetSessionId,
      outcome: 'cancelled',
    }
  }

  async importSession(config: RuntimeImportConfig): Promise<RuntimeImportResult> {
    return {
      type: 'host.importResult',
      operationId: config.operationId,
      targetSessionId: config.targetSessionId,
      outcome: 'cancelled',
    }
  }

  async exportSession(config: RuntimeExportConfig): Promise<RuntimeExportResult> {
    return {
      type: 'host.exportResult',
      operationId: config.operationId,
      sourceSessionId: config.sourceSessionId,
      outcome: 'completed',
    }
  }

  async navigateSession(config: RuntimeNavigateConfig): Promise<RuntimeNavigateResult> {
    return {
      type: 'host.navigateResult',
      operationId: config.operationId,
      sourceSessionId: config.sourceSessionId,
      outcome: 'cancelled',
    }
  }

  async compactSession(config: RuntimeCompactConfig): Promise<RuntimeCompactResult> {
    return {
      type: 'host.compactResult',
      operationId: config.operationId,
      sourceSessionId: config.sourceSessionId,
      outcome: 'cancelled',
    }
  }

  async labelSessionEntry(config: RuntimeLabelConfig): Promise<RuntimeLabelResult> {
    return {
      type: 'host.labelResult',
      operationId: config.operationId,
      sourceSessionId: config.sourceSessionId,
      outcome: 'failed',
      message: 'unused',
    }
  }

  abortSessionOperation(): void {}

  async reloadResources(): Promise<void> {}

  stop(): void {}

  respondToExtensionUi(): void {}

  queueMessage(): void {}

  clearQueue(): void {}

  isActive(): boolean {
    return false
  }

  async dispose(): Promise<void> {}
}

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

it('persists TUI session-level Pi events before exposing the same JSONL projection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pictor-tui-jsonl-'))
  roots.push(root)
  const projectRoot = join(root, 'project')
  const dataDirectory = join(root, 'data-v1')
  await mkdir(projectRoot, { recursive: true })
  const secretStore = new SecretStore(dataDirectory)
  await secretStore.setApiKey('tui-test-key')
  const repository = new AppRepository(dataDirectory, secretStore)
  await repository.initialize()
  const project = await repository.ensureProjectByPath(projectRoot)
  const session = await repository.createSession(project.id)
  const piPath = join(dataDirectory, 'pi', project.id, session.id, 'session.jsonl')
  await mkdir(join(dataDirectory, 'pi', project.id, session.id), { recursive: true })
  await writeFile(
    piPath,
    `${JSON.stringify({
      type: 'session',
      version: 3,
      id: 'pi-session',
      timestamp: now,
      cwd: projectRoot,
    })}\n`,
  )
  await repository.bindPiSession(session.id, { id: 'pi-session', path: piPath })
  expect((await repository.getSession(session.id)).messages).toEqual([])
  await repository.saveSettings({
    apiProtocol: 'responses',
    baseUrl: 'https://example.test/v1',
    modelId: 'example-model',
    reasoningEffort: null,
    temperature: null,
    maxOutputTokens: 64,
    apiKey: { action: 'keep' },
  })

  const runtime = new NoopRuntimeHost()
  let resolveProjection!: () => void
  const projectionPersisted = new Promise<void>((resolve) => {
    resolveProjection = resolve
  })
  const coordinator = new RuntimeCoordinator(repository, runtime, (event) => {
    runtime.events.push(event)
    if (event.type === 'session.activeLeafChanged' && event.activeLeafId === 'assistant-entry') {
      resolveProjection()
    }
  })
  const kernel = new ModuleKernel()
  await kernel.start([
    createAgentWorkspaceHostModule({
      repository,
      runtime: coordinator,
      connectionTester: new ModelConnectionTester(),
    }),
  ])
  const router = new ModuleRouter(kernel.getContributions(moduleHandlerContributions))
  const workspace = createAgentWorkspaceClient({
    invoke: (moduleId, method, input) => router.invoke(moduleId, method, input),
    onEvent: () => () => undefined,
  })
  const notifyActiveLeaf = (activeLeafId: string): void => {
    coordinator.handleEvent({
      type: 'session.activeLeafChanged',
      runId: null,
      sessionId: session.id,
      activeLeafId,
      at: now,
    })
  }
  const runner = {
    run: async () => {
      await appendFile(
        piPath,
        `${JSON.stringify({
          type: 'message',
          id: 'user-entry',
          parentId: null,
          timestamp: now,
          message: { role: 'user', content: 'TUI task' },
        })}\n`,
      )
      notifyActiveLeaf('user-entry')
      await appendFile(
        piPath,
        `${JSON.stringify({
          type: 'message',
          id: 'assistant-entry',
          parentId: 'user-entry',
          timestamp: now,
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'TUI answer' }],
            stopReason: 'stop',
          },
        })}\n`,
      )
      notifyActiveLeaf('assistant-entry')
    },
  }
  const output: string[] = []
  const context: TuiApplicationContext = {
    terminal: {
      columns: 80,
      rows: 24,
      start: () => undefined,
      stop: () => undefined,
      write: (value) => void output.push(value),
    },
    workspace,
    commandClient: new CommandEngine([]).getClient(),
    interactive: { createInteractiveRunner: () => runner },
    launchTarget: {
      projectPath: null,
      sessionId: session.id,
      nonInteractive: false,
      tuiMode: 'regular',
    },
    signal: new AbortController().signal,
  }
  const modules = await entrypoint({ process: 'tui', pluginId: 'pictor.tui.delegate' })
  // Use a separate Plugin Kernel for the Delegate contribution; the workspace
  // Kernel above owns the real Repository Module contract.
  const delegateKernel = new ModuleKernel()
  await delegateKernel.start(modules)
  const contribution = delegateKernel.getContributions(tuiApplicationContributions)[0]!

  await contribution.run(context)
  await projectionPersisted

  const projected = await workspace.inspectSessionHistory({ sessionId: session.id, entryId: null })
  expect(projected).toMatchObject({ ok: true })
  if (!projected.ok) throw new Error(projected.error.message)
  const stored = await repository.getSession(session.id)
  expect(stored.messages).toEqual(projected.value.session.messages)
  expect(stored.messages.map(({ content }) => content)).toEqual(['TUI task', 'TUI answer'])
  expect(repository.getSessionHistory(session.id).activeLeafId).toBe('assistant-entry')
  expect(projected.value.tree?.activeLeafId).toBe('assistant-entry')
  expect(runtime.events.filter((event) => event.type === 'session.activeLeafChanged')).toHaveLength(
    2,
  )
  expect(output).toEqual([])
  await delegateKernel.stop()
  await kernel.stop()
})
