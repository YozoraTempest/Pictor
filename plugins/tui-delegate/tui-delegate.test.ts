// @vitest-environment node

import { expect, it, vi } from 'vitest'

import { CommandEngine } from '../../src/commands/engine.js'
import type { ModuleTransport } from '../../src/kernel/contract.js'
import { ModuleKernel } from '../../src/kernel/kernel.js'
import {
  createAgentWorkspaceClient,
  type AppSnapshot,
} from '../../src/modules/agent-workspace/shared.js'
import { tuiApplicationContributions, type TuiApplicationContext } from '../../src/tui/contract.js'
import type { SessionHistoryView } from '../../src/shared/domain.js'
import entrypoint from './tui.js'
import manifest from './manifest.json'

it('contributes Delegate business interaction through the public TUI contract', async () => {
  const modules = await entrypoint({ process: 'tui', pluginId: manifest.id })
  const kernel = new ModuleKernel()
  await kernel.start(modules)

  expect(kernel.getContributions(tuiApplicationContributions)).toEqual([
    expect.objectContaining({ owner: manifest.id, id: 'delegate' }),
  ])
  await kernel.stop()
})

const projectId = '11111111-1111-4111-8111-111111111111'
const sessionId = '22222222-2222-4222-8222-222222222222'
const now = '2026-09-02T00:00:00.000Z'

function snapshot(): AppSnapshot {
  return {
    projects: [
      {
        id: projectId,
        name: 'project',
        rootPath: '/workspace/project',
        trustedAt: now,
        availability: 'available',
        createdAt: now,
        updatedAt: now,
      },
    ],
    sessions: [
      {
        id: sessionId,
        projectId,
        title: 'Delegate session',
        createdAt: now,
        updatedAt: now,
        lastRunStatus: null,
      },
    ],
    selectedProjectId: projectId,
    selectedSessionId: sessionId,
    settings: {
      apiProtocol: 'responses',
      baseUrl: 'https://example.test/v1',
      modelId: 'example-model',
      reasoningEffort: null,
      temperature: null,
      maxOutputTokens: 64,
      hasApiKey: true,
    },
    issues: [],
  }
}

function history(): SessionHistoryView {
  return {
    session: {
      schemaVersion: 1,
      id: sessionId,
      projectId,
      title: 'Delegate session',
      messages: [],
      runs: [],
      createdAt: now,
      updatedAt: now,
    },
    tree: { nodes: [], activeLeafId: null, selectedEntryId: null },
  }
}

function context(options: {
  nonInteractive?: boolean
  sessionId?: string | null
  runner: { run: ReturnType<typeof vi.fn> }
}): { context: TuiApplicationContext; invoke: ReturnType<typeof vi.fn>; output: string[] } {
  const output: string[] = []
  const invoke = vi.fn(async (_moduleId: string, method: string) => {
    if (method === 'getSnapshot') return { ok: true, value: snapshot() }
    if (method === 'getSettings') return { ok: true, value: snapshot().settings }
    if (method === 'selectContext') return { ok: true, value: null }
    if (method === 'inspectSessionHistory') return { ok: true, value: history() }
    throw new Error(`unexpected workspace method ${method}`)
  })
  const transport: ModuleTransport = {
    invoke,
    onEvent: () => () => undefined,
  }
  return {
    context: {
      terminal: {
        columns: 80,
        rows: 24,
        start: () => undefined,
        stop: () => undefined,
        write: (value: string) => void output.push(value),
      },
      workspace: createAgentWorkspaceClient(transport),
      commandClient: new CommandEngine([]).getClient(),
      interactive: { createInteractiveRunner: () => options.runner },
      launchTarget: {
        projectPath: null,
        sessionId: options.sessionId === undefined ? sessionId : options.sessionId,
        nonInteractive: options.nonInteractive ?? false,
        tuiMode: 'regular',
      },
      signal: new AbortController().signal,
    },
    invoke,
    output,
  }
}

it('runs Pi through the TUI runtime seam and re-reads the authoritative JSONL projection', async () => {
  const modules = await entrypoint({ process: 'tui', pluginId: manifest.id })
  const kernel = new ModuleKernel()
  await kernel.start(modules)
  const contribution = kernel.getContributions(tuiApplicationContributions)[0]!
  const runner = { run: vi.fn(async () => undefined) }
  const fixture = context({ runner })

  await contribution.run(fixture.context)

  expect(runner.run).toHaveBeenCalledOnce()
  expect(fixture.invoke).toHaveBeenCalledWith('pictor.agent-workspace', 'inspectSessionHistory', {
    sessionId,
    entryId: null,
  })
  await kernel.stop()
})

it('has a deterministic first-use path without creating an implicit project', async () => {
  const modules = await entrypoint({ process: 'tui', pluginId: manifest.id })
  const kernel = new ModuleKernel()
  await kernel.start(modules)
  const contribution = kernel.getContributions(tuiApplicationContributions)[0]!
  const runner = { run: vi.fn(async () => undefined) }
  const fixture = context({ runner, nonInteractive: true, sessionId: null })
  fixture.context.workspace.getSnapshot = async () => ({
    ok: true,
    value: {
      ...snapshot(),
      projects: [],
      sessions: [],
      selectedProjectId: null,
      selectedSessionId: null,
    },
  })

  await contribution.run(fixture.context)

  expect(fixture.output.join('')).toContain('首次使用')
  expect(runner.run).not.toHaveBeenCalled()
  expect(fixture.invoke).not.toHaveBeenCalled()
  await kernel.stop()
})
