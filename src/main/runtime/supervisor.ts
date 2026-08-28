import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import { utilityProcess, type UtilityProcess } from 'electron'

import {
  runtimeEventSchema,
  runtimeHostMessageSchema,
  type RuntimeCommand,
  type RuntimeCompactConfig,
  type RuntimeCompactResult,
  type RuntimeEvent,
  type RuntimeExportConfig,
  type RuntimeExportResult,
  type RuntimeForkConfig,
  type RuntimeForkResult,
  type RuntimeImportConfig,
  type RuntimeImportResult,
  type RuntimeLabelConfig,
  type RuntimeLabelResult,
  type RuntimeNavigateConfig,
  type RuntimeNavigateResult,
  type RuntimeSessionOpenConfig,
  type RuntimeStartConfig,
  type RuntimeSessionReplacementRequest,
  type RuntimeControlsSnapshot,
} from '../../shared/runtime-protocol.js'
import type { RuntimePluginBootstrap } from '../../shared/plugins.js'

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'stopped', 'interrupted'])
const RUNTIME_READY_TIMEOUT_MS = 30_000

export class RuntimeSupervisor {
  private child: UtilityProcess | null = null
  private activeRunId: string | null = null
  private activeSessionId: string | null = null
  private readyPromise: Promise<void> | null = null
  private resolveReady: (() => void) | null = null
  private rejectReady: ((error: Error) => void) | null = null
  private pendingFork: {
    operationId: string
    resolve: (result: RuntimeForkResult) => void
    reject: (error: Error) => void
  } | null = null
  private pendingImport: {
    operationId: string
    resolve: (result: RuntimeImportResult) => void
    reject: (error: Error) => void
  } | null = null
  private pendingExport: {
    operationId: string
    resolve: (result: RuntimeExportResult) => void
    reject: (error: Error) => void
  } | null = null
  private pendingNavigate: {
    operationId: string
    resolve: (result: RuntimeNavigateResult) => void
    reject: (error: Error) => void
  } | null = null
  private pendingCompact: {
    operationId: string
    resolve: (result: RuntimeCompactResult) => void
    reject: (error: Error) => void
  } | null = null
  private pendingLabel: {
    operationId: string
    resolve: (result: RuntimeLabelResult) => void
    reject: (error: Error) => void
  } | null = null
  private pendingReload: {
    sessionId: string
    resolve: () => void
    reject: (error: Error) => void
  } | null = null
  private pendingControls: {
    sessionId: string
    resolve: (result: RuntimeControlsSnapshot) => void
    reject: (error: Error) => void
  } | null = null
  private pendingControlsSet: {
    requestId: string
    sessionId: string
    resolve: () => void
    reject: (error: Error) => void
  } | null = null
  private pendingSession: {
    operationId: string
    sessionId: string
    kind: 'open' | 'close'
    previousSessionId: string | null
    resolve: () => void
    reject: (error: Error) => void
  } | null = null

  constructor(
    private readonly onEvent: (event: RuntimeEvent) => void,
    private readonly pluginBootstrap: RuntimePluginBootstrap,
    private readonly onSessionReplacementRequest?: (
      request: RuntimeSessionReplacementRequest,
    ) => Promise<{ accepted: boolean; targetSessionId?: string; message?: string }>,
  ) {}

  async openSession(config: RuntimeSessionOpenConfig): Promise<void> {
    if (this.activeRunId) throw new Error('已有 Runtime 操作正在执行')
    await this.ensureChild()
    if (this.pendingSession) throw new Error('已有 Session 打开操作正在执行')
    this.activeRunId = config.operationId
    return new Promise<void>((resolve, reject) => {
      this.pendingSession = {
        operationId: config.operationId,
        sessionId: config.sessionId,
        kind: 'open',
        previousSessionId: this.activeSessionId,
        resolve,
        reject,
      }
      try {
        this.post(config)
      } catch (error) {
        this.pendingSession = null
        this.activeRunId = null
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  async closeSession(): Promise<void> {
    if (!this.child || !this.activeSessionId) return
    if (this.activeRunId) throw new Error('已有 Runtime 操作正在执行')
    const sessionId = this.activeSessionId
    const operationId = randomUUID()
    await this.ensureChild()
    if (this.pendingSession) throw new Error('已有 Session 关闭操作正在执行')
    this.activeRunId = operationId
    return new Promise<void>((resolve, reject) => {
      this.pendingSession = {
        operationId,
        sessionId,
        kind: 'close',
        previousSessionId: this.activeSessionId,
        resolve,
        reject,
      }
      try {
        this.post({ type: 'session.close', operationId, sessionId })
      } catch (error) {
        this.pendingSession = null
        this.activeRunId = null
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  async start(config: RuntimeStartConfig): Promise<void> {
    if (this.activeRunId) throw new Error('已有 Agent 运行正在执行')
    if (this.activeSessionId && this.activeSessionId !== config.sessionId) {
      throw new Error('Requested Pi Session is not open')
    }
    await this.ensureChild()
    this.activeRunId = config.runId
    this.activeSessionId = config.sessionId
    this.post(config)
  }

  async fork(config: RuntimeForkConfig): Promise<RuntimeForkResult> {
    if (this.activeRunId) throw new Error('已有 Runtime 操作正在执行')
    await this.ensureChild()
    this.activeRunId = config.operationId
    this.activeSessionId = config.sourceSessionId
    return new Promise<RuntimeForkResult>((resolve, reject) => {
      this.pendingFork = { operationId: config.operationId, resolve, reject }
      try {
        this.post(config)
      } catch (error) {
        this.pendingFork = null
        this.activeRunId = null
        this.activeSessionId = null
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  async importSession(config: RuntimeImportConfig): Promise<RuntimeImportResult> {
    if (this.activeRunId) throw new Error('已有 Runtime 操作正在执行')
    await this.ensureChild()
    this.activeRunId = config.operationId
    this.activeSessionId = config.targetSessionId
    return new Promise<RuntimeImportResult>((resolve, reject) => {
      this.pendingImport = { operationId: config.operationId, resolve, reject }
      try {
        this.post(config)
      } catch (error) {
        this.pendingImport = null
        this.activeRunId = null
        this.activeSessionId = null
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  async exportSession(config: RuntimeExportConfig): Promise<RuntimeExportResult> {
    if (this.activeRunId) throw new Error('已有 Runtime 操作正在执行')
    await this.ensureChild()
    this.activeRunId = config.operationId
    this.activeSessionId = config.sourceSessionId
    return new Promise<RuntimeExportResult>((resolve, reject) => {
      this.pendingExport = { operationId: config.operationId, resolve, reject }
      try {
        this.post(config)
      } catch (error) {
        this.pendingExport = null
        this.activeRunId = null
        this.activeSessionId = null
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  async navigateSession(config: RuntimeNavigateConfig): Promise<RuntimeNavigateResult> {
    if (this.activeRunId) throw new Error('已有 Runtime 操作正在执行')
    await this.ensureChild()
    this.activeRunId = config.operationId
    this.activeSessionId = config.sourceSessionId
    return new Promise<RuntimeNavigateResult>((resolve, reject) => {
      this.pendingNavigate = { operationId: config.operationId, resolve, reject }
      try {
        this.post(config)
      } catch (error) {
        this.pendingNavigate = null
        this.activeRunId = null
        this.activeSessionId = null
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  async compactSession(config: RuntimeCompactConfig): Promise<RuntimeCompactResult> {
    if (this.activeRunId) throw new Error('已有 Runtime 操作正在执行')
    await this.ensureChild()
    this.activeRunId = config.operationId
    this.activeSessionId = config.sourceSessionId
    return new Promise<RuntimeCompactResult>((resolve, reject) => {
      this.pendingCompact = { operationId: config.operationId, resolve, reject }
      try {
        this.post(config)
      } catch (error) {
        this.pendingCompact = null
        this.activeRunId = null
        this.activeSessionId = null
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  async labelSessionEntry(config: RuntimeLabelConfig): Promise<RuntimeLabelResult> {
    if (this.activeRunId) throw new Error('已有 Runtime 操作正在执行')
    await this.ensureChild()
    this.activeRunId = config.operationId
    this.activeSessionId = config.sourceSessionId
    return new Promise<RuntimeLabelResult>((resolve, reject) => {
      this.pendingLabel = { operationId: config.operationId, resolve, reject }
      try {
        this.post(config)
      } catch (error) {
        this.pendingLabel = null
        this.activeRunId = null
        this.activeSessionId = null
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  abortSessionOperation(operationId: string): void {
    this.assertActive(operationId)
    this.post({ type: 'abort-session-operation', operationId })
  }

  stop(runId: string): void {
    this.assertActive(runId)
    this.post({ type: 'abort', runId })
  }

  respondToExtensionUi(sessionId: string, requestId: string, value: string | boolean | null): void {
    this.assertActiveSession(sessionId)
    this.post({ type: 'extension.ui.respond', sessionId, requestId, value })
  }

  updateComposerText(sessionId: string, text: string): void {
    this.assertActiveSession(sessionId)
    this.post({ type: 'extension.composer.update', sessionId, text })
  }

  async getRuntimeControls(sessionId: string): Promise<RuntimeControlsSnapshot | null> {
    if (!this.child || this.activeSessionId !== sessionId) return null
    if (this.pendingControls) throw new Error('已有 Session Controls 查询正在执行')
    return new Promise<RuntimeControlsSnapshot>((resolve, reject) => {
      this.pendingControls = { sessionId, resolve, reject }
      try {
        this.post({ type: 'controls.get', sessionId })
      } catch (error) {
        this.pendingControls = null
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  setRuntimeControls(
    sessionId: string,
    controls: Omit<RuntimeControlsSnapshot, 'type' | 'sessionId' | 'availableTools'>,
  ): Promise<void> {
    if (!this.child) return Promise.resolve()
    if (this.activeSessionId !== sessionId) {
      throw new Error('Requested Pi Session is not open')
    }
    if (this.pendingControlsSet) throw new Error('已有 Session Controls 更新正在执行')
    const requestId = randomUUID()
    return new Promise<void>((resolve, reject) => {
      this.pendingControlsSet = { requestId, sessionId, resolve, reject }
      try {
        this.post({ type: 'controls.set', requestId, sessionId, ...controls })
      } catch (error) {
        this.pendingControlsSet = null
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  queueMessage(runId: string, mode: 'steer' | 'follow-up', message: string): void {
    this.assertActive(runId)
    this.post({ type: mode, runId, message })
  }

  clearQueue(runId: string): void {
    this.assertActive(runId)
    this.post({ type: 'clear-queue', runId })
  }

  isActive(): boolean {
    return this.activeRunId !== null
  }

  async reloadResources(sessionId: string): Promise<void> {
    if (!this.child || this.activeSessionId !== sessionId) {
      throw new Error('Requested Pi Session is not open')
    }
    if (this.activeRunId) throw new Error('已有 Agent 运行正在执行')
    return new Promise<void>((resolve, reject) => {
      this.pendingReload = { sessionId, resolve, reject }
      try {
        this.post({ type: 'reload-resources', sessionId })
      } catch (error) {
        this.pendingReload = null
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  async dispose(): Promise<void> {
    const child = this.child
    if (!child) return
    this.post({ type: 'dispose' })
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        child.kill()
        resolve()
      }, 2_000)
      child.once('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
    })
    this.child = null
    this.pendingFork?.reject(new Error('Agent Runtime 已关闭'))
    this.pendingFork = null
    this.pendingImport?.reject(new Error('Agent Runtime 已关闭'))
    this.pendingImport = null
    this.pendingExport?.reject(new Error('Agent Runtime 已关闭'))
    this.pendingExport = null
    this.pendingNavigate?.reject(new Error('Agent Runtime 已关闭'))
    this.pendingNavigate = null
    this.pendingCompact?.reject(new Error('Agent Runtime 已关闭'))
    this.pendingCompact = null
    this.pendingLabel?.reject(new Error('Agent Runtime 已关闭'))
    this.pendingLabel = null
    this.pendingReload?.reject(new Error('Agent Runtime 已关闭'))
    this.pendingReload = null
    this.pendingControls?.reject(new Error('Agent Runtime 已关闭'))
    this.pendingControls = null
    this.pendingControlsSet?.reject(new Error('Agent Runtime 已关闭'))
    this.pendingControlsSet = null
    this.pendingSession?.reject(new Error('Agent Runtime 已关闭'))
    this.pendingSession = null
    this.activeRunId = null
    this.activeSessionId = null
  }

  private async ensureChild(): Promise<void> {
    if (!this.child) {
      const child = utilityProcess.fork(join(__dirname, 'runtime/host.js'), [], {
        serviceName: 'Pictor Agent Runtime',
        env: {
          ...process.env,
          PICTOR_RUNTIME_PLUGIN_BOOTSTRAP: JSON.stringify(this.pluginBootstrap),
        },
      })
      this.child = child
      this.readyPromise = new Promise<void>((resolve, reject) => {
        this.resolveReady = resolve
        this.rejectReady = reject
      })
      child.on('message', (message) => this.handleMessage(message))
      child.on('exit', (_code) => this.handleExit(child))
    }
    const readyPromise = this.readyPromise
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        readyPromise,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Agent Runtime 启动超时')),
            RUNTIME_READY_TIMEOUT_MS,
          )
        }),
      ])
    } catch (error) {
      this.child?.kill()
      throw error
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }

  private handleMessage(message: unknown): void {
    const parsed = runtimeHostMessageSchema.safeParse(message)
    if (!parsed.success) return
    if (parsed.data.type === 'host.ready') {
      this.resolveReady?.()
      this.resolveReady = null
      this.rejectReady = null
      return
    }
    if (parsed.data.type === 'host.fatal') {
      this.rejectReady?.(new Error(parsed.data.message))
      if (this.pendingFork) {
        this.pendingFork.reject(new Error(parsed.data.message))
        this.pendingFork = null
        this.activeRunId = null
        this.activeSessionId = null
      }
      if (this.pendingImport) {
        this.pendingImport.reject(new Error(parsed.data.message))
        this.pendingImport = null
        this.activeRunId = null
        this.activeSessionId = null
      }
      if (this.pendingExport) {
        this.pendingExport.reject(new Error(parsed.data.message))
        this.pendingExport = null
        this.activeRunId = null
        this.activeSessionId = null
      }
      if (this.pendingNavigate) {
        this.pendingNavigate.reject(new Error(parsed.data.message))
        this.pendingNavigate = null
        this.activeRunId = null
        this.activeSessionId = null
      }
      if (this.pendingCompact) {
        this.pendingCompact.reject(new Error(parsed.data.message))
        this.pendingCompact = null
        this.activeRunId = null
        this.activeSessionId = null
      }
      if (this.pendingLabel) {
        this.pendingLabel.reject(new Error(parsed.data.message))
        this.pendingLabel = null
        this.activeRunId = null
        this.activeSessionId = null
      }
      if (this.pendingControlsSet) {
        this.pendingControlsSet.reject(new Error(parsed.data.message))
        this.pendingControlsSet = null
      }
      if (this.pendingSession) {
        this.pendingSession.reject(new Error(parsed.data.message))
        this.pendingSession = null
        this.activeRunId = null
        this.activeSessionId = null
      }
      this.emitSyntheticFailure(parsed.data.message)
      return
    }
    if (parsed.data.type === 'session.replacement.requested') {
      const request = parsed.data as RuntimeSessionReplacementRequest
      const replacement: Promise<{
        accepted: boolean
        targetSessionId?: string
        message?: string
      }> = this.onSessionReplacementRequest
        ? this.onSessionReplacementRequest(request)
        : Promise.resolve({ accepted: true })
      void replacement.then(
        (result) =>
          this.post({
            type: 'session.replacement.ack',
            operationId: request.operationId,
            phase: request.phase,
            accepted: result?.accepted ?? true,
            ...(result?.targetSessionId ? { targetSessionId: result.targetSessionId } : {}),
            ...(result?.message ? { message: result.message } : {}),
          }),
        (error) =>
          this.post({
            type: 'session.replacement.ack',
            operationId: request.operationId,
            phase: request.phase,
            accepted: false,
            message: error instanceof Error ? error.message : 'Session replacement failed',
          }),
      )
      return
    }
    if (parsed.data.type === 'host.reloadResult') {
      const pending = this.pendingReload
      if (!pending || pending.sessionId !== parsed.data.sessionId) return
      this.pendingReload = null
      if (parsed.data.outcome === 'completed') pending.resolve()
      else pending.reject(new Error(parsed.data.message ?? 'Pi resource reload failed'))
      return
    }
    if (parsed.data.type === 'host.sessionResult') {
      const pending = this.pendingSession
      if (
        !pending ||
        pending.operationId !== parsed.data.operationId ||
        pending.sessionId !== parsed.data.sessionId
      ) {
        return
      }
      this.pendingSession = null
      this.activeRunId = null
      if (parsed.data.outcome === 'failed') {
        this.activeSessionId = pending.previousSessionId
        pending.reject(new Error(parsed.data.message ?? 'Pi Session operation failed'))
      } else {
        this.activeSessionId = parsed.data.outcome === 'opened' ? pending.sessionId : null
        pending.resolve()
      }
      return
    }
    if (parsed.data.type === 'host.controlsSetResult') {
      const pending = this.pendingControlsSet
      if (
        !pending ||
        pending.requestId !== parsed.data.requestId ||
        pending.sessionId !== parsed.data.sessionId
      ) {
        return
      }
      this.pendingControlsSet = null
      if (parsed.data.outcome === 'failed') {
        pending.reject(new Error(parsed.data.message ?? 'Session Controls update failed'))
      } else {
        pending.resolve()
      }
      return
    }
    if (parsed.data.type === 'host.controlsResult') {
      const pending = this.pendingControls
      if (!pending || pending.sessionId !== parsed.data.sessionId) return
      this.pendingControls = null
      pending.resolve(parsed.data)
      return
    }
    if (parsed.data.type === 'host.forkResult') {
      const pending = this.pendingFork
      if (!pending || pending.operationId !== parsed.data.operationId) return
      this.pendingFork = null
      this.activeRunId = null
      this.activeSessionId = null
      pending.resolve(parsed.data)
      return
    }
    if (parsed.data.type === 'host.importResult') {
      const pending = this.pendingImport
      if (!pending || pending.operationId !== parsed.data.operationId) return
      this.pendingImport = null
      this.activeRunId = null
      this.activeSessionId = null
      pending.resolve(parsed.data)
      return
    }
    if (parsed.data.type === 'host.exportResult') {
      const pending = this.pendingExport
      if (!pending || pending.operationId !== parsed.data.operationId) return
      this.pendingExport = null
      this.activeRunId = null
      this.activeSessionId = null
      pending.resolve(parsed.data)
      return
    }
    if (parsed.data.type === 'host.navigateResult') {
      const pending = this.pendingNavigate
      if (!pending || pending.operationId !== parsed.data.operationId) return
      this.pendingNavigate = null
      this.activeRunId = null
      this.activeSessionId = null
      pending.resolve(parsed.data)
      return
    }
    if (parsed.data.type === 'host.compactResult') {
      const pending = this.pendingCompact
      if (!pending || pending.operationId !== parsed.data.operationId) return
      this.pendingCompact = null
      this.activeRunId = null
      this.activeSessionId = null
      pending.resolve(parsed.data)
      return
    }
    if (parsed.data.type === 'host.labelResult') {
      const pending = this.pendingLabel
      if (!pending || pending.operationId !== parsed.data.operationId) return
      this.pendingLabel = null
      this.activeRunId = null
      this.activeSessionId = null
      pending.resolve(parsed.data)
      return
    }
    const event = runtimeEventSchema.parse(parsed.data)
    if (event.type === 'session.replaced') this.activeSessionId = event.targetSessionId
    else if (event.type === 'session.bound') this.activeSessionId = event.sessionId
    this.onEvent(event)
    if (event.type === 'run.stateChanged' && TERMINAL_STATUSES.has(event.status)) {
      this.activeRunId = null
    }
  }

  private handleExit(child: UtilityProcess): void {
    if (this.child !== child) return
    this.child = null
    this.readyPromise = null
    this.resolveReady = null
    this.rejectReady?.(new Error('Agent Runtime 在就绪前退出'))
    this.rejectReady = null
    if (this.pendingFork) {
      this.pendingFork.reject(new Error('Agent Runtime 在 Fork 完成前退出'))
      this.pendingFork = null
      this.activeRunId = null
      this.activeSessionId = null
    }
    if (this.pendingImport) {
      this.pendingImport.reject(new Error('Agent Runtime 在 Import 完成前退出'))
      this.pendingImport = null
      this.activeRunId = null
      this.activeSessionId = null
    }
    if (this.pendingExport) {
      this.pendingExport.reject(new Error('Agent Runtime 在 Export 完成前退出'))
      this.pendingExport = null
      this.activeRunId = null
      this.activeSessionId = null
    }
    if (this.pendingNavigate) {
      this.pendingNavigate.reject(new Error('Agent Runtime 在 Tree Navigation 完成前退出'))
      this.pendingNavigate = null
      this.activeRunId = null
      this.activeSessionId = null
    }
    if (this.pendingCompact) {
      this.pendingCompact.reject(new Error('Agent Runtime 在 Compaction 完成前退出'))
      this.pendingCompact = null
      this.activeRunId = null
      this.activeSessionId = null
    }
    if (this.pendingLabel) {
      this.pendingLabel.reject(new Error('Agent Runtime 在 Label 完成前退出'))
      this.pendingLabel = null
      this.activeRunId = null
      this.activeSessionId = null
    }
    if (this.pendingReload) {
      this.pendingReload.reject(new Error('Agent Runtime 在资源重载完成前退出'))
      this.pendingReload = null
    }
    if (this.pendingControls) {
      this.pendingControls.reject(new Error('Agent Runtime 在 Controls 查询完成前退出'))
      this.pendingControls = null
    }
    if (this.pendingControlsSet) {
      this.pendingControlsSet.reject(new Error('Agent Runtime 在 Controls 更新完成前退出'))
      this.pendingControlsSet = null
    }
    if (this.pendingSession) {
      this.pendingSession.reject(new Error('Agent Runtime 在 Session 操作完成前退出'))
      this.pendingSession = null
      this.activeRunId = null
      this.activeSessionId = null
    }
    if (this.activeRunId) this.emitSyntheticFailure('Agent Runtime 进程意外退出')
  }

  private emitSyntheticFailure(message: string): void {
    const runId = this.activeRunId
    const sessionId = this.activeSessionId
    if (!runId || !sessionId) return
    const at = new Date().toISOString()
    this.onEvent(
      runtimeEventSchema.parse({
        type: 'runtime.error',
        runId,
        sessionId,
        at,
        category: 'runtime',
        message,
      }),
    )
    this.onEvent(
      runtimeEventSchema.parse({
        type: 'run.stateChanged',
        runId,
        sessionId,
        at,
        status: 'failed',
        error: message,
      }),
    )
    this.activeRunId = null
    this.activeSessionId = null
  }

  private assertActive(runId: string): void {
    if (this.activeRunId !== runId) throw new Error('运行不存在或已经结束')
  }

  private assertActiveSession(sessionId: string): void {
    if (!this.child || this.activeSessionId !== sessionId) {
      throw new Error('Pi Session 不存在或已经切换')
    }
  }

  private post(command: RuntimeCommand): void {
    if (!this.child) throw new Error('Agent Runtime 尚未启动')
    this.child.postMessage(command)
  }
}
