import { randomUUID } from 'node:crypto'

import {
  messageSchema,
  runRecordSchema,
  toolEventSchema,
  type Project,
  type SessionRecord,
} from '../../shared/domain.js'
import { PictorError } from '../../shared/errors.js'
import type { ModelSettings } from '../../shared/model.js'
import { type RuntimeEvent, type RuntimeStartConfig } from '../../shared/runtime-protocol.js'
import { createSecretRedactor, type SecretRedactor } from '../../shared/secret-redaction.js'

export interface RuntimePersistence {
  getSession(sessionId: string): Promise<SessionRecord>
  getProject(projectId: string): Project
  getSettings(): Promise<ModelSettings | null>
  getApiKey(): Promise<string | null>
  getRuntimePaths(
    projectId: string,
    sessionId: string,
  ): {
    agentDirectory: string
    sessionDirectory: string
    resumeSession: boolean
  }
  saveSession(session: SessionRecord): Promise<unknown>
}

export interface RuntimeHost {
  start(config: RuntimeStartConfig): Promise<void>
  approve(runId: string, callId: string): void
  reject(runId: string, callId: string): void
  stop(runId: string): void
  isActive(): boolean
}

interface ActiveRun {
  session: SessionRecord
  runId: string
  assistantMessageId: string
  redactor: SecretRedactor
}

export class RuntimeCoordinator {
  private active: ActiveRun | null = null
  private persistenceQueue = Promise.resolve()

  constructor(
    private readonly repository: RuntimePersistence,
    private readonly supervisor: RuntimeHost,
    private readonly broadcast: (event: RuntimeEvent) => void,
    private readonly commandInterpreterPath: string | null = null,
  ) {}

  async start(sessionId: string, prompt: string): Promise<{ runId: string }> {
    if (this.active || this.supervisor.isActive()) {
      throw new PictorError('invalid-input', '已有 Agent 运行正在执行，请先等待或停止该运行')
    }
    const session = await this.repository.getSession(sessionId)
    const project = this.repository.getProject(session.projectId)
    if (project.availability !== 'available') {
      throw new PictorError('project-unavailable', '项目目录当前不可用，请重新关联或移除项目')
    }
    const settings = await this.repository.getSettings()
    const apiKey = await this.repository.getApiKey()
    if (!settings || !apiKey) {
      throw new PictorError('invalid-input', '请先保存完整的模型 API 设置')
    }
    const redactor = createSecretRedactor([apiKey])
    const sanitizedPrompt = redactor.redactText(prompt)

    const now = new Date().toISOString()
    const runId = randomUUID()
    const assistantMessageId = randomUUID()
    session.messages.push(
      messageSchema.parse({
        id: randomUUID(),
        role: 'user',
        content: sanitizedPrompt,
        status: 'completed',
        createdAt: now,
        updatedAt: now,
      }),
      messageSchema.parse({
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        status: 'streaming',
        createdAt: now,
        updatedAt: now,
      }),
    )
    session.runs.push(
      runRecordSchema.parse({
        id: runId,
        status: 'queued',
        toolEvents: [],
        error: null,
        createdAt: now,
        updatedAt: now,
      }),
    )
    if (session.title === '新建会话') {
      session.title = sanitizedPrompt.replace(/\s+/g, ' ').slice(0, 48)
    }
    session.updatedAt = now
    await this.repository.saveSession(session)
    this.active = { session, runId, assistantMessageId, redactor }

    const runtimePaths = this.repository.getRuntimePaths(project.id, session.id)
    try {
      await this.supervisor.start({
        type: 'start',
        runId,
        sessionId,
        messageId: assistantMessageId,
        projectRoot: project.rootPath,
        ...runtimePaths,
        commandInterpreterPath: this.commandInterpreterPath,
        settings: {
          apiProtocol: settings.apiProtocol,
          baseUrl: settings.baseUrl,
          modelId: settings.modelId,
          reasoningEffort: settings.reasoningEffort,
          temperature: settings.temperature,
          maxOutputTokens: settings.maxOutputTokens,
        },
        apiKey,
        prompt: sanitizedPrompt,
      })
    } catch (error) {
      this.active = null
      const run = session.runs.find((candidate) => candidate.id === runId)
      if (run) {
        run.status = 'failed'
        run.error =
          error instanceof Error ? redactor.redactText(error.message) : '无法启动 Agent Runtime'
        run.updatedAt = new Date().toISOString()
      }
      await this.repository.saveSession(session)
      throw error
    }
    return { runId }
  }

  approve(runId: string, callId: string): void {
    this.supervisor.approve(runId, callId)
  }

  reject(runId: string, callId: string): void {
    this.supervisor.reject(runId, callId)
  }

  stop(runId: string): void {
    this.supervisor.stop(runId)
  }

  isActive(): boolean {
    return this.active !== null || this.supervisor.isActive()
  }

  handleEvent(event: RuntimeEvent): void {
    const active = this.active
    const sanitizedEvent = active ? active.redactor.redactRuntimeEvent(event) : event
    if (
      !active ||
      active.runId !== sanitizedEvent.runId ||
      active.session.id !== sanitizedEvent.sessionId
    ) {
      this.broadcast(sanitizedEvent)
      return
    }
    const terminalEvent =
      sanitizedEvent.type === 'run.stateChanged' &&
      ['completed', 'failed', 'stopped', 'interrupted'].includes(sanitizedEvent.status)
    this.applyEvent(active, sanitizedEvent)
    if (
      sanitizedEvent.type === 'message.delta' ||
      sanitizedEvent.type === 'message.completed' ||
      sanitizedEvent.type === 'tool.updated'
    ) {
      this.broadcast(sanitizedEvent)
    } else {
      this.persistenceQueue = this.persistenceQueue
        .then(() => this.repository.saveSession(active.session))
        .then(() => {
          if (terminalEvent && this.active === active) this.active = null
          this.broadcast(sanitizedEvent)
        })
        .catch(() => {
          if (terminalEvent && this.active === active) this.active = null
          this.broadcast({
            type: 'runtime.error',
            runId: sanitizedEvent.runId,
            sessionId: sanitizedEvent.sessionId,
            at: new Date().toISOString(),
            category: 'runtime',
            message: '运行状态无法写入本地存储，请停止当前任务并检查磁盘权限',
          })
        })
    }
  }

  private applyEvent(active: ActiveRun, event: RuntimeEvent): void {
    const run = active.session.runs.find((candidate) => candidate.id === active.runId)
    const assistant = active.session.messages.find(
      (message) => message.id === active.assistantMessageId,
    )
    if (!run || !assistant) return
    active.session.updatedAt = event.at

    if (event.type === 'run.stateChanged') {
      run.status = event.status
      run.error = event.error
      run.updatedAt = event.at
      if (event.status === 'failed') assistant.status = 'failed'
      if (event.status === 'stopped') assistant.status = 'completed'
      return
    }
    if (event.type === 'message.delta') {
      assistant.content += event.delta
      assistant.updatedAt = event.at
      return
    }
    if (event.type === 'message.completed') {
      assistant.content = event.content
      assistant.status = 'completed'
      assistant.updatedAt = event.at
      return
    }
    if (event.type === 'tool.started') {
      run.toolEvents.push(
        toolEventSchema.parse({
          id: randomUUID(),
          callId: event.callId,
          kind: event.kind,
          label: event.label,
          path: event.path,
          command: null,
          status: 'running',
          output: null,
          createdAt: event.at,
          updatedAt: event.at,
        }),
      )
      return
    }
    const tool =
      'callId' in event
        ? run.toolEvents.find((candidate) => candidate.callId === event.callId)
        : undefined
    if (event.type === 'tool.updated' && tool) {
      tool.output = event.output
      tool.updatedAt = event.at
      return
    }
    if (event.type === 'tool.completed' && tool) {
      tool.output = event.output
      tool.status = event.isError ? 'failed' : 'completed'
      tool.updatedAt = event.at
      return
    }
    if (event.type === 'approval.requested' && tool) {
      tool.command = {
        command: event.command,
        cwd: event.cwd,
        purpose: event.purpose,
        approval: 'pending',
      }
      run.status = 'awaiting-approval'
      run.updatedAt = event.at
      return
    }
    if (event.type === 'approval.resolved' && tool?.command) {
      tool.command.approval = event.allowed ? 'allowed' : 'rejected'
      if (!event.allowed) tool.status = 'rejected'
      run.status = 'running'
      run.updatedAt = event.at
      return
    }
    if (event.type === 'runtime.error') {
      run.error = event.message
      run.updatedAt = event.at
    }
  }
}
