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
  type RuntimeNavigateConfig,
  type RuntimeNavigateResult,
  type RuntimeStartConfig,
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

  constructor(
    private readonly onEvent: (event: RuntimeEvent) => void,
    private readonly pluginBootstrap: RuntimePluginBootstrap,
  ) {}

  async start(config: RuntimeStartConfig): Promise<void> {
    if (this.activeRunId) throw new Error('已有 Agent 运行正在执行')
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

  abortSessionOperation(operationId: string): void {
    this.assertActive(operationId)
    this.post({ type: 'abort-session-operation', operationId })
  }

  approve(runId: string, callId: string): void {
    this.assertActive(runId)
    this.post({ type: 'approve', runId, callId })
  }

  reject(runId: string, callId: string): void {
    this.assertActive(runId)
    this.post({ type: 'reject', runId, callId })
  }

  stop(runId: string): void {
    this.assertActive(runId)
    this.post({ type: 'abort', runId })
  }

  respondToExtensionUi(runId: string, requestId: string, value: string | boolean | null): void {
    this.assertActive(runId)
    this.post({ type: 'extension.ui.respond', runId, requestId, value })
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
      this.emitSyntheticFailure(parsed.data.message)
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
    const event = runtimeEventSchema.parse(parsed.data)
    this.onEvent(event)
    if (event.type === 'run.stateChanged' && TERMINAL_STATUSES.has(event.status)) {
      this.activeRunId = null
      this.activeSessionId = null
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

  private post(command: RuntimeCommand): void {
    if (!this.child) throw new Error('Agent Runtime 尚未启动')
    this.child.postMessage(command)
  }
}
