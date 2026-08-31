import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import { utilityProcess, type UtilityProcess } from 'electron'

import {
  runtimeEventSchema,
  runtimeHostMessageSchema,
  type RuntimeCommand,
  type RuntimeCompactConfig,
  type RuntimeCompactResult,
  type RuntimeControlsSnapshot,
  type RuntimeEvent,
  type RuntimeExportConfig,
  type RuntimeExportResult,
  type RuntimeForkConfig,
  type RuntimeForkResult,
  type RuntimeHostMessage,
  type RuntimeImportConfig,
  type RuntimeImportResult,
  type RuntimeLabelConfig,
  type RuntimeLabelResult,
  type RuntimeNavigateConfig,
  type RuntimeNavigateResult,
  type RuntimeSessionOpenConfig,
  type RuntimeSessionReplacementRequest,
  type RuntimeStartConfig,
} from '../../shared/runtime-protocol.js'
import type { RuntimePluginBootstrap } from '../../shared/plugins.js'

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'stopped', 'interrupted'])
const RUNTIME_READY_TIMEOUT_MS = 30_000

type RuntimeProcessState =
  | { status: 'stopped' }
  | {
      status: 'starting'
      child: UtilityProcess
      ready: Promise<void>
      resolveReady: () => void
      rejectReady: (error: Error) => void
    }
  | { status: 'ready'; child: UtilityProcess }
  | { status: 'stopping'; child: UtilityProcess }

type RuntimeActivityState =
  | { status: 'idle'; sessionId: string | null }
  | { status: 'busy'; id: string; sessionId: string | null }

type RuntimeRequestKey =
  | 'session'
  | 'fork'
  | 'import'
  | 'export'
  | 'navigate'
  | 'compact'
  | 'label'
  | 'reload'
  | 'controls-get'
  | 'controls-set'

type RuntimeRequestRejection = 'post' | 'fatal' | 'exit' | 'dispose'

interface PendingRuntimeRequest {
  readonly key: RuntimeRequestKey
  readonly exitMessage: string
  matches(message: RuntimeHostMessage): boolean
  settle(message: RuntimeHostMessage): void
  reject(error: Error, reason: RuntimeRequestRejection): void
}

interface RuntimeRequestOptions<Message extends RuntimeHostMessage, Result> {
  readonly key: RuntimeRequestKey
  readonly command: RuntimeCommand
  readonly duplicateMessage: string
  readonly exitMessage: string
  readonly matches: (message: RuntimeHostMessage) => message is Message
  readonly transform: (message: Message) => Result
  readonly onReject?: (reason: RuntimeRequestRejection) => void
}

type RuntimeOperationCompletion<Result> =
  { sessionId: string | null; result: Result } | { sessionId: string | null; error: Error }

type RuntimeHostMessageOf<Type extends RuntimeHostMessage['type']> = Extract<
  RuntimeHostMessage,
  { type: Type }
>

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

class RuntimeRequestBroker {
  private readonly pending = new Map<RuntimeRequestKey, PendingRuntimeRequest>()

  request<Message extends RuntimeHostMessage, Result>(
    options: RuntimeRequestOptions<Message, Result>,
    post: (command: RuntimeCommand) => void,
  ): Promise<Result> {
    if (this.pending.has(options.key)) throw new Error(options.duplicateMessage)

    return new Promise<Result>((resolve, reject) => {
      const pending: PendingRuntimeRequest = {
        key: options.key,
        exitMessage: options.exitMessage,
        matches: options.matches,
        settle: (message) => {
          try {
            resolve(options.transform(message as Message))
          } catch (error) {
            reject(toError(error))
          }
        },
        reject: (error, reason) => {
          options.onReject?.(reason)
          reject(error)
        },
      }
      this.pending.set(options.key, pending)

      try {
        post(options.command)
      } catch (error) {
        this.pending.delete(options.key)
        pending.reject(toError(error), 'post')
      }
    })
  }

  settle(message: RuntimeHostMessage): boolean {
    for (const [key, pending] of this.pending) {
      if (!pending.matches(message)) continue
      this.pending.delete(key)
      pending.settle(message)
      return true
    }
    return false
  }

  rejectAll(
    createError: (pending: PendingRuntimeRequest) => Error,
    reason: RuntimeRequestRejection,
  ): void {
    for (const [key, pending] of this.pending) {
      this.pending.delete(key)
      pending.reject(createError(pending), reason)
    }
  }
}

export class RuntimeSupervisor {
  private processState: RuntimeProcessState = { status: 'stopped' }
  private activity: RuntimeActivityState = { status: 'idle', sessionId: null }
  private readonly requests = new RuntimeRequestBroker()

  constructor(
    private readonly onEvent: (event: RuntimeEvent) => void,
    private readonly pluginBootstrap: RuntimePluginBootstrap,
    private readonly onSessionReplacementRequest?: (
      request: RuntimeSessionReplacementRequest,
    ) => Promise<{ accepted: boolean; targetSessionId?: string; message?: string }>,
  ) {}

  openSession(config: RuntimeSessionOpenConfig): Promise<void> {
    return this.requestRuntimeOperation({
      key: 'session',
      command: config,
      operationId: config.operationId,
      sessionIdDuring: (previousSessionId) => previousSessionId,
      busyMessage: '已有 Runtime 操作正在执行',
      duplicateMessage: '已有 Session 打开操作正在执行',
      exitMessage: 'Agent Runtime 在 Session 操作完成前退出',
      matches: (message): message is RuntimeHostMessageOf<'host.sessionResult'> =>
        message.type === 'host.sessionResult' &&
        message.operationId === config.operationId &&
        message.sessionId === config.sessionId,
      complete: (message, previousSessionId) => {
        if (message.outcome === 'failed') {
          return {
            sessionId: previousSessionId,
            error: new Error(message.message ?? 'Pi Session operation failed'),
          }
        }
        return {
          sessionId: message.outcome === 'opened' ? config.sessionId : null,
          result: undefined,
        }
      },
    })
  }

  closeSession(): Promise<void> {
    const sessionId = this.activity.sessionId
    if (this.processState.status === 'stopped' || !sessionId) return Promise.resolve()
    const operationId = randomUUID()
    return this.requestRuntimeOperation({
      key: 'session',
      command: { type: 'session.close', operationId, sessionId },
      operationId,
      sessionIdDuring: sessionId,
      busyMessage: '已有 Runtime 操作正在执行',
      duplicateMessage: '已有 Session 关闭操作正在执行',
      exitMessage: 'Agent Runtime 在 Session 操作完成前退出',
      matches: (message): message is RuntimeHostMessageOf<'host.sessionResult'> =>
        message.type === 'host.sessionResult' &&
        message.operationId === operationId &&
        message.sessionId === sessionId,
      complete: (message, previousSessionId) => {
        if (message.outcome === 'failed') {
          return {
            sessionId: previousSessionId,
            error: new Error(message.message ?? 'Pi Session operation failed'),
          }
        }
        return { sessionId: message.outcome === 'opened' ? sessionId : null, result: undefined }
      },
    })
  }

  async start(config: RuntimeStartConfig): Promise<void> {
    this.assertIdle('已有 Agent 运行正在执行')
    this.assertSessionAvailable(config.sessionId)
    await this.ensureChild()
    this.assertIdle('已有 Agent 运行正在执行')
    this.assertSessionAvailable(config.sessionId)

    const previousSessionId = this.activity.sessionId
    this.activity = { status: 'busy', id: config.runId, sessionId: config.sessionId }
    try {
      this.post(config)
    } catch (error) {
      this.activity = { status: 'idle', sessionId: previousSessionId }
      throw toError(error)
    }
  }

  fork(config: RuntimeForkConfig): Promise<RuntimeForkResult> {
    return this.requestRuntimeOperation({
      key: 'fork',
      command: config,
      operationId: config.operationId,
      sessionIdDuring: config.sourceSessionId,
      busyMessage: '已有 Runtime 操作正在执行',
      duplicateMessage: '已有 Pi Session Fork 正在执行',
      exitMessage: 'Agent Runtime 在 Fork 完成前退出',
      matches: (message): message is RuntimeHostMessageOf<'host.forkResult'> =>
        message.type === 'host.forkResult' && message.operationId === config.operationId,
      complete: (message) => ({ sessionId: null, result: message }),
    })
  }

  importSession(config: RuntimeImportConfig): Promise<RuntimeImportResult> {
    return this.requestRuntimeOperation({
      key: 'import',
      command: config,
      operationId: config.operationId,
      sessionIdDuring: config.targetSessionId,
      busyMessage: '已有 Runtime 操作正在执行',
      duplicateMessage: '已有 Pi Session Import 正在执行',
      exitMessage: 'Agent Runtime 在 Import 完成前退出',
      matches: (message): message is RuntimeHostMessageOf<'host.importResult'> =>
        message.type === 'host.importResult' && message.operationId === config.operationId,
      complete: (message) => ({ sessionId: null, result: message }),
    })
  }

  exportSession(config: RuntimeExportConfig): Promise<RuntimeExportResult> {
    return this.requestRuntimeOperation({
      key: 'export',
      command: config,
      operationId: config.operationId,
      sessionIdDuring: config.sourceSessionId,
      busyMessage: '已有 Runtime 操作正在执行',
      duplicateMessage: '已有 Pi Session Export 正在执行',
      exitMessage: 'Agent Runtime 在 Export 完成前退出',
      matches: (message): message is RuntimeHostMessageOf<'host.exportResult'> =>
        message.type === 'host.exportResult' && message.operationId === config.operationId,
      complete: (message, previousSessionId) => ({
        sessionId: previousSessionId,
        result: message,
      }),
    })
  }

  navigateSession(config: RuntimeNavigateConfig): Promise<RuntimeNavigateResult> {
    return this.requestRuntimeOperation({
      key: 'navigate',
      command: config,
      operationId: config.operationId,
      sessionIdDuring: config.sourceSessionId,
      busyMessage: '已有 Runtime 操作正在执行',
      duplicateMessage: '已有 Pi Session Tree Navigation 正在执行',
      exitMessage: 'Agent Runtime 在 Tree Navigation 完成前退出',
      matches: (message): message is RuntimeHostMessageOf<'host.navigateResult'> =>
        message.type === 'host.navigateResult' && message.operationId === config.operationId,
      complete: (message, previousSessionId) => ({
        sessionId: message.outcome === 'failed' ? previousSessionId : config.sourceSessionId,
        result: message,
      }),
    })
  }

  compactSession(config: RuntimeCompactConfig): Promise<RuntimeCompactResult> {
    return this.requestRuntimeOperation({
      key: 'compact',
      command: config,
      operationId: config.operationId,
      sessionIdDuring: config.sourceSessionId,
      busyMessage: '已有 Runtime 操作正在执行',
      duplicateMessage: '已有 Pi Session Compaction 正在执行',
      exitMessage: 'Agent Runtime 在 Compaction 完成前退出',
      matches: (message): message is RuntimeHostMessageOf<'host.compactResult'> =>
        message.type === 'host.compactResult' && message.operationId === config.operationId,
      complete: (message, previousSessionId) => ({
        sessionId: message.outcome === 'failed' ? previousSessionId : config.sourceSessionId,
        result: message,
      }),
    })
  }

  labelSessionEntry(config: RuntimeLabelConfig): Promise<RuntimeLabelResult> {
    return this.requestRuntimeOperation({
      key: 'label',
      command: config,
      operationId: config.operationId,
      sessionIdDuring: config.sourceSessionId,
      busyMessage: '已有 Runtime 操作正在执行',
      duplicateMessage: '已有 Pi Session Label 正在执行',
      exitMessage: 'Agent Runtime 在 Label 完成前退出',
      matches: (message): message is RuntimeHostMessageOf<'host.labelResult'> =>
        message.type === 'host.labelResult' && message.operationId === config.operationId,
      complete: (message, previousSessionId) => ({
        sessionId: message.outcome === 'failed' ? previousSessionId : config.sourceSessionId,
        result: message,
      }),
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
    if (this.processState.status !== 'ready' || this.activity.sessionId !== sessionId) {
      return Promise.resolve(null)
    }
    return this.requests.request(
      {
        key: 'controls-get',
        command: { type: 'controls.get', sessionId },
        duplicateMessage: '已有 Session Controls 查询正在执行',
        exitMessage: 'Agent Runtime 在 Controls 查询完成前退出',
        matches: (message): message is RuntimeHostMessageOf<'host.controlsResult'> =>
          message.type === 'host.controlsResult' && message.sessionId === sessionId,
        transform: (message) => message,
      },
      (command) => this.post(command),
    )
  }

  setRuntimeControls(
    sessionId: string,
    controls: Omit<RuntimeControlsSnapshot, 'type' | 'sessionId' | 'availableTools'>,
  ): Promise<void> {
    if (this.processState.status === 'stopped') return Promise.resolve()
    if (this.activity.sessionId !== sessionId) {
      throw new Error('Requested Pi Session is not open')
    }
    const requestId = randomUUID()
    return this.requests.request(
      {
        key: 'controls-set',
        command: { type: 'controls.set', requestId, sessionId, ...controls },
        duplicateMessage: '已有 Session Controls 更新正在执行',
        exitMessage: 'Agent Runtime 在 Controls 更新完成前退出',
        matches: (message): message is RuntimeHostMessageOf<'host.controlsSetResult'> =>
          message.type === 'host.controlsSetResult' &&
          message.requestId === requestId &&
          message.sessionId === sessionId,
        transform: (message) => {
          if (message.outcome === 'failed') {
            throw new Error(message.message ?? 'Session Controls update failed')
          }
        },
      },
      (command) => this.post(command),
    )
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
    return this.activity.status === 'busy'
  }

  async reloadResources(sessionId: string): Promise<void> {
    if (this.processState.status !== 'ready' || this.activity.sessionId !== sessionId) {
      throw new Error('Requested Pi Session is not open')
    }
    this.assertIdle('已有 Agent 运行正在执行')
    return this.requests.request(
      {
        key: 'reload',
        command: { type: 'reload-resources', sessionId },
        duplicateMessage: '已有 Pi resource reload 正在执行',
        exitMessage: 'Agent Runtime 在资源重载完成前退出',
        matches: (message): message is RuntimeHostMessageOf<'host.reloadResult'> =>
          message.type === 'host.reloadResult' && message.sessionId === sessionId,
        transform: (message) => {
          if (message.outcome === 'failed') {
            throw new Error(message.message ?? 'Pi resource reload failed')
          }
        },
      },
      (command) => this.post(command),
    )
  }

  async dispose(): Promise<void> {
    const state = this.processState
    if (state.status === 'stopped') {
      this.resetRuntimeState('Agent Runtime 已关闭')
      return
    }

    const child = state.child
    if (state.status === 'starting') state.rejectReady(new Error('Agent Runtime 已关闭'))
    this.processState = { status: 'stopping', child }
    try {
      child.postMessage({ type: 'dispose' } satisfies RuntimeCommand)
    } catch {
      child.kill()
    }

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

    if (this.isCurrentChild(child)) {
      this.processState = { status: 'stopped' }
    }
    this.resetRuntimeState('Agent Runtime 已关闭')
  }

  private async requestRuntimeOperation<Message extends RuntimeHostMessage, Result>(options: {
    key: RuntimeRequestKey
    command: RuntimeCommand
    operationId: string
    sessionIdDuring: string | null | ((previousSessionId: string | null) => string | null)
    busyMessage: string
    duplicateMessage: string
    exitMessage: string
    matches: (message: RuntimeHostMessage) => message is Message
    complete: (
      message: Message,
      previousSessionId: string | null,
    ) => RuntimeOperationCompletion<Result>
  }): Promise<Result> {
    this.assertIdle(options.busyMessage)
    await this.ensureChild()
    this.assertIdle(options.busyMessage)

    const previousSessionId = this.activity.sessionId
    const sessionIdDuring =
      typeof options.sessionIdDuring === 'function'
        ? options.sessionIdDuring(previousSessionId)
        : options.sessionIdDuring
    this.activity = { status: 'busy', id: options.operationId, sessionId: sessionIdDuring }

    try {
      return this.requests.request(
        {
          key: options.key,
          command: options.command,
          duplicateMessage: options.duplicateMessage,
          exitMessage: options.exitMessage,
          matches: options.matches,
          transform: (message) => {
            const completion = options.complete(message, previousSessionId)
            this.activity = { status: 'idle', sessionId: completion.sessionId }
            if ('error' in completion) throw completion.error
            return completion.result
          },
          onReject: (reason) => {
            this.activity = {
              status: 'idle',
              sessionId: reason === 'post' ? previousSessionId : null,
            }
          },
        },
        (command) => this.post(command),
      )
    } catch (error) {
      this.activity = { status: 'idle', sessionId: previousSessionId }
      throw error
    }
  }

  private async ensureChild(): Promise<void> {
    if (this.processState.status === 'stopped') this.spawnChild()
    const state = this.processState
    if (state.status === 'stopped') throw new Error('Agent Runtime 尚未启动')
    if (state.status === 'stopping') throw new Error('Agent Runtime 正在关闭')
    if (state.status === 'ready') return

    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        state.ready,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Agent Runtime 启动超时')),
            RUNTIME_READY_TIMEOUT_MS,
          )
        }),
      ])
    } catch (error) {
      if (this.processState.status !== 'stopped' && this.processState.child === state.child) {
        state.child.kill()
      }
      throw error
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }

  private spawnChild(): void {
    const child = utilityProcess.fork(join(__dirname, 'runtime/host.js'), [], {
      serviceName: 'Pictor Agent Runtime',
      env: {
        ...process.env,
        PICTOR_RUNTIME_PLUGIN_BOOTSTRAP: JSON.stringify(this.pluginBootstrap),
      },
    })
    let resolveReady!: () => void
    let rejectReady!: (error: Error) => void
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    this.processState = { status: 'starting', child, ready, resolveReady, rejectReady }
    child.on('message', (message) => this.handleMessage(child, message))
    child.on('exit', () => this.handleExit(child))
  }

  private handleMessage(child: UtilityProcess, message: unknown): void {
    const processState = this.processState
    if (processState.status === 'stopped' || processState.child !== child) return

    const parsed = runtimeHostMessageSchema.safeParse(message)
    if (!parsed.success) return
    if (parsed.data.type === 'host.ready') {
      if (processState.status !== 'starting') return
      this.processState = { status: 'ready', child }
      processState.resolveReady()
      return
    }
    if (parsed.data.type === 'host.fatal') {
      const message = parsed.data.message
      if (processState.status === 'starting') processState.rejectReady(new Error(message))
      this.requests.rejectAll(() => new Error(message), 'fatal')
      this.emitSyntheticFailure(message)
      return
    }
    if (parsed.data.type === 'session.replacement.requested') {
      void this.handleSessionReplacementRequest(child, parsed.data)
      return
    }
    if (this.requests.settle(parsed.data)) return

    const event = runtimeEventSchema.safeParse(parsed.data)
    if (!event.success) return
    if (event.data.type === 'session.replaced') this.setActiveSession(event.data.targetSessionId)
    else if (event.data.type === 'session.bound') this.setActiveSession(event.data.sessionId)
    this.onEvent(event.data)
    if (event.data.type === 'run.stateChanged' && TERMINAL_STATUSES.has(event.data.status)) {
      this.activity = { status: 'idle', sessionId: this.activity.sessionId }
    }
  }

  private async handleSessionReplacementRequest(
    child: UtilityProcess,
    request: RuntimeSessionReplacementRequest,
  ): Promise<void> {
    let result: { accepted: boolean; targetSessionId?: string; message?: string }
    try {
      result = this.onSessionReplacementRequest
        ? await this.onSessionReplacementRequest(request)
        : { accepted: true }
    } catch (error) {
      result = {
        accepted: false,
        message: error instanceof Error ? error.message : 'Session replacement failed',
      }
    }

    if (this.processState.status !== 'ready' || this.processState.child !== child) return
    this.post({
      type: 'session.replacement.ack',
      operationId: request.operationId,
      phase: request.phase,
      accepted: result.accepted,
      ...(result.targetSessionId ? { targetSessionId: result.targetSessionId } : {}),
      ...(result.message ? { message: result.message } : {}),
    })
  }

  private handleExit(child: UtilityProcess): void {
    const processState = this.processState
    if (processState.status === 'stopped' || processState.child !== child) return
    const expected = processState.status === 'stopping'
    if (processState.status === 'starting') {
      processState.rejectReady(new Error('Agent Runtime 在就绪前退出'))
    }
    this.processState = { status: 'stopped' }
    this.requests.rejectAll(
      (pending) => new Error(expected ? 'Agent Runtime 已关闭' : pending.exitMessage),
      expected ? 'dispose' : 'exit',
    )

    if (!expected && this.activity.status === 'busy') {
      this.emitSyntheticFailure('Agent Runtime 进程意外退出')
    } else {
      this.activity = { status: 'idle', sessionId: null }
    }
  }

  private emitSyntheticFailure(message: string): void {
    if (this.activity.status !== 'busy' || !this.activity.sessionId) return
    const { id: runId, sessionId } = this.activity
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
    this.activity = { status: 'idle', sessionId: null }
  }

  private resetRuntimeState(message: string): void {
    this.requests.rejectAll(() => new Error(message), 'dispose')
    this.activity = { status: 'idle', sessionId: null }
  }

  private assertIdle(message: string): void {
    if (this.activity.status === 'busy') throw new Error(message)
  }

  private assertSessionAvailable(sessionId: string): void {
    if (this.activity.sessionId && this.activity.sessionId !== sessionId) {
      throw new Error('Requested Pi Session is not open')
    }
  }

  private assertActive(runId: string): void {
    if (this.activity.status !== 'busy' || this.activity.id !== runId) {
      throw new Error('运行不存在或已经结束')
    }
  }

  private assertActiveSession(sessionId: string): void {
    if (this.processState.status !== 'ready' || this.activity.sessionId !== sessionId) {
      throw new Error('Pi Session 不存在或已经切换')
    }
  }

  private setActiveSession(sessionId: string): void {
    this.activity = { ...this.activity, sessionId }
  }

  private isCurrentChild(child: UtilityProcess): boolean {
    const state = this.processState
    return state.status !== 'stopped' && state.child === child
  }

  private post(command: RuntimeCommand): void {
    if (this.processState.status !== 'ready') throw new Error('Agent Runtime 尚未启动')
    this.processState.child.postMessage(command)
  }
}
