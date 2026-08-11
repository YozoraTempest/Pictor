import { randomUUID } from 'node:crypto'

import {
  messageSchema,
  runRecordSchema,
  toolEventSchema,
  type RuntimeEvent,
  type SessionRecord,
} from '../../src/shared/contracts.js'
import { PictorError } from './errors.js'
import type { AppRepository } from './persistence/app-repository.js'
import type { RuntimeSupervisor } from './runtime-supervisor.js'

interface ActiveRun {
  session: SessionRecord
  runId: string
  assistantMessageId: string
}

export class RuntimeCoordinator {
  private active: ActiveRun | null = null
  private persistenceQueue = Promise.resolve()

  constructor(
    private readonly repository: AppRepository,
    private readonly supervisor: RuntimeSupervisor,
    private readonly broadcast: (event: RuntimeEvent) => void,
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

    const now = new Date().toISOString()
    const runId = randomUUID()
    const assistantMessageId = randomUUID()
    session.messages.push(
      messageSchema.parse({
        id: randomUUID(),
        role: 'user',
        content: prompt,
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
    if (session.title === '新建会话') session.title = prompt.replace(/\s+/g, ' ').slice(0, 48)
    session.updatedAt = now
    await this.repository.saveSession(session)
    this.active = { session, runId, assistantMessageId }

    const runtimePaths = this.repository.getRuntimePaths(project.id, session.id)
    try {
      await this.supervisor.start({
        type: 'start',
        runId,
        sessionId,
        messageId: assistantMessageId,
        projectRoot: project.rootPath,
        ...runtimePaths,
        settings: {
          apiProtocol: settings.apiProtocol,
          baseUrl: settings.baseUrl,
          modelId: settings.modelId,
          reasoningEffort: settings.reasoningEffort,
          temperature: settings.temperature,
          maxOutputTokens: settings.maxOutputTokens,
        },
        apiKey,
        prompt,
      })
    } catch (error) {
      this.active = null
      const run = session.runs.find((candidate) => candidate.id === runId)
      if (run) {
        run.status = 'failed'
        run.error = error instanceof Error ? error.message : '无法启动 Agent Runtime'
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
    if (!active || active.runId !== event.runId || active.session.id !== event.sessionId) {
      this.broadcast(event)
      return
    }
    this.applyEvent(active, event)
    if (event.type === 'message.delta' || event.type === 'tool.updated') {
      this.broadcast(event)
    } else {
      this.persistenceQueue = this.persistenceQueue
        .then(() => this.repository.saveSession(active.session))
        .then(() => this.broadcast(event))
        .catch(() => {
          this.broadcast({
            type: 'runtime.error',
            runId: event.runId,
            sessionId: event.sessionId,
            at: new Date().toISOString(),
            category: 'runtime',
            message: '运行状态无法写入本地存储，请停止当前任务并检查磁盘权限',
          })
        })
    }
    if (
      event.type === 'run.stateChanged' &&
      ['completed', 'failed', 'stopped', 'interrupted'].includes(event.status)
    ) {
      this.active = null
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
