import { createAgentWorkspaceClient } from '../modules/agent-workspace/shared.js'
import type { ApplicationHostServices } from '../application/index.js'
import { PluginHost, type PluginDefinition, type PluginStatus } from '../plugin/host.js'
import type {
  InteractiveRuntimeOptions,
  InteractiveRuntimeRunner,
} from '../runtime/plugin-interface.js'
import {
  tuiApplicationContributions,
  type TuiApplicationContext,
  type TuiInteractiveRuntime,
  type TuiLaunchTarget,
  type TuiTerminal,
} from './contract.js'
import { createTuiPluginDefinitions, type TuiPluginSnapshot } from './plugin-loader.js'

export type TuiSignal = 'SIGINT' | 'SIGTERM'

export interface TuiSignalSource {
  on(signal: TuiSignal, listener: () => void): unknown
  off(signal: TuiSignal, listener: () => void): unknown
}

export interface TuiHostOptions {
  readonly applicationHost: TuiApplicationHost
  readonly terminal: TuiTerminal
  readonly interactive: TuiInteractiveRuntime
  readonly launchTarget: TuiLaunchTarget
  readonly safeMode: boolean
  readonly signals?: TuiSignalSource
  readonly onApplicationStarted?: (services: TuiApplicationServices) => void
  readonly createPluginDefinitions?: (
    plugins: readonly TuiPluginSnapshot[],
  ) => readonly PluginDefinition[] | Promise<readonly PluginDefinition[]>
}

export interface TuiApplicationServices {
  readonly appInfo: ApplicationHostServices['appInfo']
  readonly commandClient: ApplicationHostServices['commandClient']
  readonly pluginStore: Pick<ApplicationHostServices['pluginStore'], 'getSnapshot'>
  readonly moduleRouter: Pick<ApplicationHostServices['moduleRouter'], 'invoke'>
  readonly runtime: Pick<
    ApplicationHostServices['runtime'],
    'handleEvent' | 'handleSessionReplacementRequest'
  >
}

export interface TuiApplicationHost {
  start(): Promise<TuiApplicationServices>
  stop(): Promise<void>
}

export type TuiHostErrorCode =
  'no-available-tui' | 'multiple-tui' | 'plugin-failed' | 'cancelled' | 'fatal'

export interface TuiHostErrorInfo {
  readonly code: TuiHostErrorCode
  readonly message: string
}

export interface TuiHostResult {
  readonly outcome: 'completed' | 'cancelled' | 'failed'
  readonly error?: TuiHostErrorInfo
  readonly pluginStatuses: readonly PluginStatus[]
}

type HostState = 'new' | 'starting' | 'running' | 'stopping' | 'stopped'

export class TuiHost {
  private state: HostState = 'new'
  private runPromise: Promise<TuiHostResult> | null = null
  private cleanupPromise: Promise<void> | null = null
  private applicationServices: TuiApplicationServices | null = null
  private pluginHost: PluginHost | null = null
  private pluginStatuses: readonly PluginStatus[] = []
  private activeRunner: InteractiveRuntimeRunner | null = null
  private abortController: AbortController | null = null
  private signalListener: (() => void) | null = null

  constructor(private readonly options: TuiHostOptions) {}

  run(): Promise<TuiHostResult> {
    if (this.state === 'running' || this.state === 'starting') return this.runPromise!
    if (this.state !== 'new') throw new Error(`TUI Host cannot run from ${this.state} state`)

    this.state = 'starting'
    this.runPromise = this.runInternal()
    return this.runPromise
  }

  getStatuses(): readonly PluginStatus[] {
    return this.pluginStatuses.map((status) => ({ ...status }))
  }

  async dispose(): Promise<void> {
    if (this.cleanupPromise) return this.cleanupPromise
    this.cleanupPromise = this.cleanup()
    return this.cleanupPromise
  }

  private async runInternal(): Promise<TuiHostResult> {
    let outcome: TuiHostResult['outcome'] = 'completed'
    let error: TuiHostErrorInfo | undefined

    try {
      const services = (this.applicationServices = await this.options.applicationHost.start())
      this.options.onApplicationStarted?.(services)
      const snapshot = await services.pluginStore.getSnapshot()
      const definitions = await (
        this.options.createPluginDefinitions ?? createTuiPluginDefinitions
      )(snapshot.plugins)
      const pluginHost = (this.pluginHost = new PluginHost({
        pictorVersion: services.appInfo.version,
        safeMode: this.options.safeMode,
      }))
      this.pluginStatuses = await pluginHost.start(definitions)

      const contributions = pluginHost.getContributions(tuiApplicationContributions)
      if (contributions.length === 0) {
        const failed = this.pluginStatuses.filter(
          ({ effectiveState }) => effectiveState === 'failed',
        )
        if (failed.length > 0) {
          throw new TuiHostError(
            'plugin-failed',
            `TUI Plugin 加载失败：${failed
              .map(({ id, reason }) => `${id}: ${reason ?? 'activation failed'}`)
              .join('; ')}`,
          )
        }
        throw new TuiHostError('no-available-tui', unavailableTuiMessage(this.pluginStatuses))
      }
      if (contributions.length > 1) {
        throw new TuiHostError(
          'multiple-tui',
          `发现多个可用 TUI Contribution：${contributions.map(({ owner }) => owner).join(', ')}`,
        )
      }

      this.state = 'running'
      const abortController = (this.abortController = new AbortController())
      this.installSignalHandlers(abortController)
      this.options.terminal.start(
        (data) => this.handleTerminalInput(data),
        () => this.activeRunner?.handleResize?.(),
      )

      const context = this.createContext(services, abortController.signal)
      await contributions[0]!.run(context)
      if (abortController.signal.aborted) {
        outcome = 'cancelled'
        error = { code: 'cancelled', message: 'TUI 已取消' }
      }
    } catch (caught) {
      const details = toTuiHostError(caught, this.pluginStatuses)
      if (details.code === 'cancelled') {
        outcome = 'cancelled'
        error = details
      } else {
        outcome = 'failed'
        error = details
      }
    } finally {
      await this.dispose().catch((caught) => {
        outcome = 'failed'
        error ??= {
          code: 'fatal',
          message: caught instanceof Error ? caught.message : String(caught),
        }
      })
    }

    return {
      outcome,
      ...(error ? { error } : {}),
      pluginStatuses: this.getStatuses(),
    }
  }

  private createContext(
    services: TuiApplicationServices,
    signal: AbortSignal,
  ): TuiApplicationContext {
    const transport = {
      invoke: (moduleId: string, method: string, input: unknown) =>
        services.moduleRouter.invoke(moduleId, method, input),
      onEvent: () => () => undefined,
    }
    const workspace = createAgentWorkspaceClient(transport)
    const interactive: TuiInteractiveRuntime = {
      createInteractiveRunner: (options?: InteractiveRuntimeOptions): InteractiveRuntimeRunner => {
        const runner = this.options.interactive.createInteractiveRunner(options)
        this.activeRunner = runner
        return runner
      },
    }
    return {
      terminal: this.options.terminal,
      workspace,
      commandClient: services.commandClient,
      interactive,
      launchTarget: this.options.launchTarget,
      signal,
    }
  }

  private installSignalHandlers(abortController: AbortController): void {
    if (!this.options.signals) return
    const listener = (): void => {
      if (abortController.signal.aborted) return
      abortController.abort(new Error('TUI interrupted'))
      void this.activeRunner?.cancel?.()
    }
    this.signalListener = listener
    this.options.signals.on('SIGINT', listener)
    this.options.signals.on('SIGTERM', listener)
  }

  private handleTerminalInput(data: string): void {
    if (data === '\u0003') {
      const abortController = this.abortController
      if (abortController && !abortController.signal.aborted) {
        abortController.abort(new Error('TUI interrupted'))
        void this.activeRunner?.cancel?.()
      }
      return
    }
    this.activeRunner?.handleInput?.(data)
  }

  private async cleanup(): Promise<void> {
    if (this.state === 'stopped') return
    this.state = 'stopping'
    let firstError: Error | null = null
    const attempt = async (action: () => void | Promise<void>): Promise<void> => {
      try {
        await action()
      } catch (caught) {
        firstError ??= caught instanceof Error ? caught : new Error(String(caught))
      }
    }

    if (this.signalListener && this.options.signals) {
      await attempt(async () => {
        this.options.signals!.off('SIGINT', this.signalListener!)
        this.options.signals!.off('SIGTERM', this.signalListener!)
      })
      this.signalListener = null
    }
    await attempt(() => this.options.terminal.stop())
    await attempt(async () => this.pluginHost?.stop())
    await attempt(async () => this.options.applicationHost.stop())
    this.activeRunner = null
    this.abortController = null
    this.applicationServices = null
    this.pluginHost = null
    this.state = 'stopped'
    if (firstError) throw firstError
  }
}

class TuiHostError extends Error {
  constructor(
    readonly code: TuiHostErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'TuiHostError'
  }
}

function toTuiHostError(error: unknown, statuses: readonly PluginStatus[]): TuiHostErrorInfo {
  if (error instanceof TuiHostError) {
    return { code: error.code, message: error.message }
  }
  const message = error instanceof Error ? error.message : String(error)
  const failed = statuses.filter(
    ({ effectiveState }) => effectiveState === 'failed' || effectiveState === 'blocked',
  )
  if (failed.length > 0 && !message.includes('Profile')) {
    return {
      code: 'plugin-failed',
      message: `${message}；${failed.map(({ id, reason }) => `${id}: ${reason ?? 'unavailable'}`).join('; ')}`,
    }
  }
  if (/interrupt|cancel/i.test(message)) return { code: 'cancelled', message: 'TUI 已取消' }
  return { code: 'fatal', message }
}

function unavailableTuiMessage(statuses: readonly PluginStatus[]): string {
  const details = statuses
    .filter(({ id, effectiveState }) => id === 'pictor.tui.delegate' || effectiveState !== 'active')
    .map(
      ({ id, effectiveState, reason }) => `${id}: ${effectiveState}${reason ? ` (${reason})` : ''}`,
    )
  return details.length > 0
    ? `没有可用的 TUI Plugin。${details.join('; ')}`
    : '没有可用的 TUI Plugin；请安装并启用 pictor.tui.delegate'
}
