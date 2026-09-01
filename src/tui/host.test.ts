// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'

import { CommandEngine } from '../commands/engine.js'
import { ModuleRouter } from '../kernel/contract.js'
import { defineModule } from '../kernel/module.js'
import { pluginManifestSchema } from '../plugin/manifest.js'
import type { ApplicationHostServices } from '../application/index.js'
import {
  TuiHost,
  type TuiApplicationHost,
  type TuiApplicationServices,
  type TuiHostOptions,
} from './host.js'
import {
  tuiApplicationContributions,
  type TuiApplicationContext,
  type TuiTerminal,
} from './contract.js'
import type { InteractiveRuntimeRunner } from '../runtime/plugin-interface.js'
import type { PluginDefinition } from '../plugin/host.js'

const appInfo: ApplicationHostServices['appInfo'] = {
  name: 'Pictor',
  version: '0.4.0',
  buildChannel: 'development',
  sourceCommit: null,
  platform: 'linux',
  arch: 'x64',
  distribution: 'unsupported-linux',
}

class FakeTerminal implements TuiTerminal {
  readonly output: string[] = []
  private inputHandler: ((data: string) => void) | undefined
  private resizeHandler: (() => void) | undefined
  readonly starts = vi.fn()
  readonly stops = vi.fn()

  columns = 80
  rows = 24

  start(onInput: (data: string) => void, onResize: () => void): void {
    this.starts()
    this.inputHandler = onInput
    this.resizeHandler = onResize
  }

  stop(): void {
    this.stops()
    this.inputHandler = undefined
    this.resizeHandler = undefined
  }

  write(data: string): void {
    this.output.push(data)
  }

  input(data: string): void {
    this.inputHandler?.(data)
  }

  resize(): void {
    this.resizeHandler?.()
  }
}

class FakeSignals {
  private readonly listeners = new Map<string, () => void>()
  readonly on = vi.fn((signal: string, listener: () => void) => {
    this.listeners.set(signal, listener)
  })
  readonly off = vi.fn((signal: string, listener: () => void) => {
    if (this.listeners.get(signal) === listener) this.listeners.delete(signal)
  })

  emit(signal: string): void {
    this.listeners.get(signal)?.()
  }
}

function services(): TuiApplicationServices {
  const emptySnapshot: Awaited<ReturnType<ApplicationHostServices['pluginStore']['getSnapshot']>> =
    {
      registry: { schemaVersion: 1, entries: [] },
      plugins: [],
      blockedPlugins: [],
      nativeExtensions: [],
      issues: [],
    }
  return {
    appInfo,
    commandClient: new CommandEngine([]).getClient(),
    pluginStore: { getSnapshot: async () => emptySnapshot },
    moduleRouter: new ModuleRouter([]),
    runtime: {
      handleEvent: vi.fn(),
      handleSessionReplacementRequest: vi.fn(async () => ({ accepted: false })),
    },
  }
}

function hostApplication(current: TuiApplicationServices): TuiApplicationHost {
  return {
    start: vi.fn(async () => current),
    stop: vi.fn(async () => undefined),
  }
}

function contributionPlugin(
  run: (context: TuiApplicationContext) => Promise<void>,
  desiredState: 'enabled' | 'disabled' | 'removed' = 'enabled',
): PluginDefinition {
  const manifest = pluginManifestSchema.parse({
    id: 'pictor.tui.test',
    name: 'TUI Test',
    version: '0.4.0',
    engines: { pictor: '^0.4.0' },
    dependencies: {},
    modules: { tui: './dist/tui.js' },
  })
  return {
    manifest,
    desiredState,
    createModules: () => [
      defineModule({
        id: 'pictor.tui.test.module',
        activate(context) {
          context.contribute(tuiApplicationContributions, {
            owner: manifest.id,
            id: 'test',
            run,
          })
        },
      }),
    ],
  }
}

function tuiOptions(
  terminal: FakeTerminal,
  applicationHost: TuiApplicationHost,
  interactive: { createInteractiveRunner: () => InteractiveRuntimeRunner },
  signals?: FakeSignals,
  createPluginDefinitions: TuiHostOptions['createPluginDefinitions'] = () => [],
): TuiHostOptions {
  return {
    applicationHost,
    terminal,
    interactive,
    launchTarget: {
      projectPath: null,
      sessionId: null,
      nonInteractive: true,
      tuiMode: 'regular' as const,
    },
    safeMode: false,
    ...(signals ? { signals } : {}),
    createPluginDefinitions,
  }
}

describe('TUI Host lifecycle', () => {
  it('routes fake terminal input/output/resize to one contribution and disposes once', async () => {
    const terminal = new FakeTerminal()
    const runner: InteractiveRuntimeRunner = {
      run: vi.fn(async () => undefined),
      handleInput: vi.fn(),
      handleResize: vi.fn(),
    }
    const interactive = { createInteractiveRunner: vi.fn(() => runner) }
    const current = services()
    const applicationHost = hostApplication(current)
    const options = tuiOptions(terminal, applicationHost, interactive, undefined, () => [
      contributionPlugin(async (context) => {
        const created = context.interactive.createInteractiveRunner()
        context.terminal.write('TUI output\n')
        terminal.input('input')
        terminal.resize()
        await created.run()
      }),
    ])

    const host = new TuiHost(options)
    const result = await host.run()
    await host.dispose()

    expect(result).toMatchObject({ outcome: 'completed' })
    expect(result.pluginStatuses).toEqual([
      expect.objectContaining({ id: 'pictor.tui.test', effectiveState: 'active' }),
    ])
    expect(terminal.output).toEqual(['TUI output\n'])
    expect(runner.handleInput).toHaveBeenCalledWith('input')
    expect(runner.handleResize).toHaveBeenCalledOnce()
    expect(terminal.starts).toHaveBeenCalledOnce()
    expect(terminal.stops).toHaveBeenCalledOnce()
    expect(applicationHost.stop).toHaveBeenCalledOnce()
  })

  it('cancels through SIGINT and cleans up terminal and Plugin Host', async () => {
    const terminal = new FakeTerminal()
    const signals = new FakeSignals()
    let finish!: () => void
    const cancel = vi.fn(() => finish())
    const runner: InteractiveRuntimeRunner = {
      run: vi.fn(() => new Promise<void>((resolve) => (finish = resolve))),
      cancel,
    }
    const current = services()
    const applicationHost = hostApplication(current)
    const options = tuiOptions(
      terminal,
      applicationHost,
      {
        createInteractiveRunner: () => runner,
      },
      signals,
      () => [
        contributionPlugin(async (context) => {
          await context.interactive.createInteractiveRunner().run()
        }),
      ],
    )

    const pending = new TuiHost(options).run()
    await vi.waitFor(() => expect(runner.run).toHaveBeenCalledOnce())
    signals.emit('SIGINT')
    const result = await pending

    expect(result).toMatchObject({
      outcome: 'cancelled',
      error: { code: 'cancelled', message: 'TUI 已取消' },
    })
    expect(cancel).toHaveBeenCalledOnce()
    expect(terminal.stops).toHaveBeenCalledOnce()
    expect(signals.off).toHaveBeenCalledTimes(2)
    expect(applicationHost.stop).toHaveBeenCalledOnce()
  })

  it.each(['disabled', 'removed'] as const)(
    'reports a deterministic no-available-TUI result for an independently %s contribution',
    async (desiredState) => {
      const terminal = new FakeTerminal()
      const current = services()
      const applicationHost = hostApplication(current)
      const options = tuiOptions(
        terminal,
        applicationHost,
        { createInteractiveRunner: () => ({ run: async () => undefined }) },
        undefined,
        () => [contributionPlugin(async () => undefined, desiredState)],
      )

      const result = await new TuiHost(options).run()

      expect(result).toMatchObject({ outcome: 'failed', error: { code: 'no-available-tui' } })
      expect(terminal.stops).toHaveBeenCalledOnce()
      expect(applicationHost.stop).toHaveBeenCalledOnce()
    },
  )

  it('surfaces a TUI Plugin activation failure as a stable plugin error', async () => {
    const terminal = new FakeTerminal()
    const current = services()
    const applicationHost = hostApplication(current)
    const options = tuiOptions(
      terminal,
      applicationHost,
      { createInteractiveRunner: () => ({ run: async () => undefined }) },
      undefined,
      () => [
        {
          ...contributionPlugin(async () => undefined),
          createModules: async () => {
            throw new Error('delegate activation failed')
          },
        },
      ],
    )

    const result = await new TuiHost(options).run()

    expect(result).toMatchObject({
      outcome: 'failed',
      error: {
        code: 'plugin-failed',
        message: expect.stringContaining('delegate activation failed'),
      },
    })
    expect(terminal.stops).toHaveBeenCalledOnce()
    expect(applicationHost.stop).toHaveBeenCalledOnce()
  })
})
