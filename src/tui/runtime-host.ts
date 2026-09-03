import type { RuntimeHost } from '../application/ports.js'
import type {
  RuntimeCompactConfig,
  RuntimeExportConfig,
  RuntimeForkConfig,
  RuntimeImportConfig,
  RuntimeLabelConfig,
  RuntimeNavigateConfig,
  RuntimeSessionOpenConfig,
  RuntimeStartConfig,
  RuntimeEvent,
  RuntimeSessionReplacementRequest,
} from '../shared/runtime-protocol.js'
import type { RuntimePluginBootstrap } from '../shared/plugins.js'
import { createRuntimePluginDefinitions } from '../plugin/loader.js'
import { PluginHost } from '../plugin/host.js'
import {
  agentRuntimeContributions,
  modelRuntimeProviderContributions,
  piExtensionPathContributions,
  type AgentRuntimeProvider,
  type InteractiveRuntimeOptions,
  type InteractiveRuntimeRunner,
} from '../runtime/plugin-interface.js'

export interface InProcessRuntimeHostOptions {
  readonly emit: (event: RuntimeEvent) => void
  readonly requestSessionReplacement?: (
    request: RuntimeSessionReplacementRequest,
  ) => Promise<{ accepted: boolean; targetSessionId?: string; message?: string }>
}

/**
 * Runtime adapter for the Node TUI Frontend. Runtime Plugins are loaded from
 * the same bootstrap as GUI/utility mode, but their public provider runs in
 * this process and never starts an Electron utility process.
 */
export class InProcessRuntimeHost implements RuntimeHost {
  private bootstrap: RuntimePluginBootstrap | null = null
  private pluginHost: PluginHost | null = null
  private runtime: AgentRuntimeProvider | null = null
  private initializePromise: Promise<void> | null = null
  private disposePromise: Promise<void> | null = null
  private statuses: readonly ReturnType<PluginHost['getStatuses']>[number][] = []

  constructor(private readonly options: InProcessRuntimeHostOptions) {}

  configurePluginBootstrap(bootstrap: RuntimePluginBootstrap): void {
    if (this.pluginHost) throw new Error('In-process Runtime Plugin Host has already initialized')
    this.bootstrap = bootstrap
  }

  initialize(): Promise<void> {
    if (this.initializePromise) return this.initializePromise
    this.initializePromise = this.initializeInternal()
    return this.initializePromise
  }

  async openSession(config: RuntimeSessionOpenConfig): Promise<void> {
    await this.initialize()
    return this.requireRuntime().openSession(config)
  }

  async closeSession(): Promise<void> {
    await this.initialize()
    return this.requireRuntime().closeSession()
  }

  async start(config: RuntimeStartConfig): Promise<void> {
    await this.initialize()
    return this.requireRuntime().start(config)
  }

  async fork(config: RuntimeForkConfig) {
    await this.initialize()
    const result = await this.requireRuntime().fork(config)
    return {
      type: 'host.forkResult' as const,
      operationId: config.operationId,
      targetSessionId: config.targetSessionId,
      ...result,
    }
  }

  async importSession(config: RuntimeImportConfig) {
    await this.initialize()
    const result = await this.requireRuntime().importSession(config)
    return {
      type: 'host.importResult' as const,
      operationId: config.operationId,
      targetSessionId: config.targetSessionId,
      ...result,
    }
  }

  async exportSession(config: RuntimeExportConfig) {
    await this.initialize()
    const result = await this.requireRuntime().exportSession(config)
    return {
      type: 'host.exportResult' as const,
      operationId: config.operationId,
      sourceSessionId: config.sourceSessionId,
      ...result,
    }
  }

  async navigateSession(config: RuntimeNavigateConfig) {
    await this.initialize()
    const result = await this.requireRuntime().navigateSession(config)
    return {
      type: 'host.navigateResult' as const,
      operationId: config.operationId,
      sourceSessionId: config.sourceSessionId,
      ...result,
    }
  }

  async compactSession(config: RuntimeCompactConfig) {
    await this.initialize()
    const result = await this.requireRuntime().compactSession(config)
    return {
      type: 'host.compactResult' as const,
      operationId: config.operationId,
      sourceSessionId: config.sourceSessionId,
      ...result,
    }
  }

  async labelSessionEntry(config: RuntimeLabelConfig) {
    await this.initialize()
    const result = await this.requireRuntime().labelSessionEntry(config)
    return {
      type: 'host.labelResult' as const,
      operationId: config.operationId,
      sourceSessionId: config.sourceSessionId,
      ...result,
    }
  }

  abortSessionOperation(operationId: string): void {
    this.requireRuntime().abortSessionOperation(operationId)
  }

  async reloadResources(sessionId: string): Promise<void> {
    await this.initialize()
    return this.requireRuntime().reloadResources(sessionId)
  }

  async getRuntimeControls(sessionId: string) {
    const result = this.runtime?.getRuntimeControls(sessionId) ?? null
    if (!result) return null
    if (result.type !== 'host.controlsResult') throw new Error('Invalid Runtime Controls result')
    return {
      modelId: result.modelId,
      thinkingLevel: result.thinkingLevel,
      activeTools: result.activeTools,
      availableTools: result.availableTools,
      steeringMode: result.steeringMode,
      followUpMode: result.followUpMode,
    }
  }

  async setRuntimeControls(
    sessionId: string,
    controls: Parameters<AgentRuntimeProvider['setRuntimeControls']>[1],
  ): Promise<void> {
    await this.initialize()
    return this.requireRuntime().setRuntimeControls(sessionId, controls)
  }

  stop(runId: string): void {
    void this.runtime?.abort(runId)
  }

  respondToExtensionUi(
    _sessionId: string,
    requestId: string,
    value: string | boolean | null,
  ): void {
    this.requireRuntime().respondToExtensionUi(requestId, value)
  }

  updateComposerText(sessionId: string, text: string): void {
    this.requireRuntime().updateComposerText(sessionId, text)
  }

  queueMessage(runId: string, mode: 'steer' | 'follow-up', message: string): void {
    void this.requireRuntime().queueMessage(runId, mode, message)
  }

  clearQueue(runId: string): void {
    this.requireRuntime().clearQueue(runId)
  }

  isActive(): boolean {
    return this.runtime?.isActive?.() ?? false
  }

  createInteractiveRunner(options?: InteractiveRuntimeOptions): InteractiveRuntimeRunner {
    const runner = this.runtime?.createInteractiveRunner?.(options)
    if (!runner) throw this.unavailableError('InteractiveMode')
    return runner
  }

  async dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise
    this.disposePromise = this.disposeInternal()
    return this.disposePromise
  }

  getPluginStatuses() {
    return this.statuses.map((status) => ({ ...status }))
  }

  private async initializeInternal(): Promise<void> {
    const bootstrap = this.bootstrap
    if (!bootstrap) throw new Error('Runtime Plugin bootstrap is not configured')

    const host = new PluginHost({
      pictorVersion: bootstrap.pictorVersion,
      safeMode: bootstrap.safeMode,
    })
    this.pluginHost = host
    try {
      const definitions = createRuntimePluginDefinitions(bootstrap, this.options.emit)
      this.statuses = await host.start(definitions)
      const runtimes = host.getContributions(agentRuntimeContributions)
      if (runtimes.length > 1) throw new Error('Multiple Agent Runtime Providers are active')
      this.runtime = runtimes[0] ?? null
      this.runtime?.configure({
        extensionPaths: host.getContributions(piExtensionPathContributions),
        skillPaths: bootstrap.skills,
        promptPaths: bootstrap.prompts,
        modelProviders: host.getContributions(modelRuntimeProviderContributions),
        ...(this.options.requestSessionReplacement
          ? { requestSessionReplacement: this.options.requestSessionReplacement }
          : {}),
      })
    } catch (error) {
      await host.stop().catch(() => undefined)
      this.pluginHost = null
      this.runtime = null
      throw error
    }
  }

  private async disposeInternal(): Promise<void> {
    const host = this.pluginHost
    this.pluginHost = null
    this.runtime = null
    if (host) await host.stop()
  }

  private requireRuntime(): AgentRuntimeProvider {
    const runtime = this.runtime
    if (runtime) return runtime
    const failures = this.statuses
      .filter(({ effectiveState }) => effectiveState === 'failed' || effectiveState === 'blocked')
      .map(({ id, reason }) => `${id}: ${reason ?? 'unavailable'}`)
    throw this.unavailableError(
      failures.length > 0
        ? `Agent Runtime Provider (${failures.join('; ')})`
        : 'Agent Runtime Provider',
    )
  }

  private unavailableError(capability: string): Error {
    return new Error(`${capability} is not installed or enabled`)
  }
}
