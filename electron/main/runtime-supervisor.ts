import { join } from 'node:path'

import { utilityProcess, type UtilityProcess } from 'electron'

import { runtimeEventSchema, type RuntimeEvent } from '../../src/shared/contracts.js'
import {
  runtimeHostMessageSchema,
  type RuntimeCommand,
  type RuntimeStartConfig,
} from '../runtime/protocol.js'

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'stopped', 'interrupted'])
const RUNTIME_READY_TIMEOUT_MS = 30_000

export class RuntimeSupervisor {
  private child: UtilityProcess | null = null
  private activeRunId: string | null = null
  private activeSessionId: string | null = null
  private readyPromise: Promise<void> | null = null
  private resolveReady: (() => void) | null = null
  private rejectReady: ((error: Error) => void) | null = null

  constructor(private readonly onEvent: (event: RuntimeEvent) => void) {}

  async start(config: RuntimeStartConfig): Promise<void> {
    if (this.activeRunId) throw new Error('已有 Agent 运行正在执行')
    await this.ensureChild()
    this.activeRunId = config.runId
    this.activeSessionId = config.sessionId
    this.post(config)
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
    this.activeRunId = null
    this.activeSessionId = null
  }

  private async ensureChild(): Promise<void> {
    if (!this.child) {
      const child = utilityProcess.fork(join(__dirname, 'runtime/host.js'), [], {
        serviceName: 'Pictor Agent Runtime',
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
      this.emitSyntheticFailure(parsed.data.message)
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
