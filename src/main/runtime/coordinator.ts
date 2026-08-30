import { randomUUID } from 'node:crypto'
import { basename, extname, isAbsolute } from 'node:path'

import {
  messageSchema,
  runRecordSchema,
  sessionRecordSchema,
  toolEventSchema,
  type ImageAttachment,
  type Project,
  type SessionHistoryState,
  type SessionHistoryView,
  type SessionRecord,
  type SessionSummary,
} from '../../shared/domain.js'
import { PictorError } from '../../shared/errors.js'
import type { ModelSettings } from '../../shared/model.js'
import {
  type RuntimeEvent,
  type RuntimeCompactConfig,
  type RuntimeCompactResult,
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
  type SessionExportFormat,
} from '../../shared/runtime-protocol.js'
import { createSecretRedactor, type SecretRedactor } from '../../shared/secret-redaction.js'

const defaultRuntimeTools = ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls']

export interface RuntimePersistence {
  selectContext?(projectId: string | null, sessionId: string | null): Promise<void>
  getSelectedContext(): { projectId: string | null; sessionId: string | null }
  removeProject(projectId: string): Promise<void>
  deleteSession(sessionId: string): Promise<void>
  getSession(sessionId: string): Promise<SessionRecord>
  getSessionHistory(sessionId: string): SessionHistoryState
  inspectSessionHistory(
    sessionId: string,
    selectedEntryId: string | null,
  ): Promise<SessionHistoryView>
  bindPiSession(sessionId: string, identity: { id: string; path: string }): Promise<void>
  rebuildSessionProjection(sessionId: string): Promise<SessionRecord>
  setPiSessionActiveLeaf(sessionId: string, activeLeafId: string | null): Promise<void>
  setSessionRuntimePreferences?(
    sessionId: string,
    runtimePreferences: NonNullable<SessionHistoryState['runtimePreferences']>,
  ): Promise<void>
  createDerivedSession(
    sourceSessionId: string,
    targetSessionId: string,
    kind: 'fork' | 'clone',
    identity: { id: string; path: string },
  ): Promise<SessionSummary>
  createImportedSession(
    projectId: string,
    targetSessionId: string,
    title: string,
    identity: { id: string; path: string },
  ): Promise<SessionSummary>
  commitSessionReplacement?(
    operationId: string,
    sourceSessionId: string,
    targetSessionId: string,
    kind: 'new' | 'fork' | 'switch',
    identity: { id: string; path: string },
    targetProjectId?: string,
    cwd?: string,
  ): Promise<SessionSummary>
  prepareSessionReplacement?(entry: {
    operationId: string
    sourceSessionId: string
    targetSessionId: string
    kind: 'new' | 'fork' | 'switch'
    targetProjectId?: string
    targetSessionPath: string | null
    sourcePiSessionPath: string | null
  }): Promise<void>
  abortSessionReplacement?(operationId: string): Promise<void>
  findSessionByPiSessionPath?(piSessionPath: string): Promise<SessionSummary | null>
  getProject(projectId: string): Project
  findProjectByPath?(rootPath: string): Promise<Project | null>
  ensureProjectByPath?(rootPath: string): Promise<Project>
  getSettings(): Promise<ModelSettings | null>
  getApiKey(): Promise<string | null>
  getRuntimePaths(
    projectId: string,
    sessionId: string,
  ): {
    agentDirectory: string
    sessionDirectory: string
    resumeSession: boolean
    piSessionPath?: string | null
    activeLeafId?: string | null
    runtimePreferences?: SessionHistoryState['runtimePreferences']
  }
  saveSession(session: SessionRecord): Promise<unknown>
}

export interface RuntimeHost {
  openSession?(config: RuntimeSessionOpenConfig): Promise<void>
  closeSession?(): Promise<void>
  start(config: RuntimeStartConfig): Promise<void>
  fork(config: RuntimeForkConfig): Promise<RuntimeForkResult>
  importSession(config: RuntimeImportConfig): Promise<RuntimeImportResult>
  exportSession(config: RuntimeExportConfig): Promise<RuntimeExportResult>
  navigateSession(config: RuntimeNavigateConfig): Promise<RuntimeNavigateResult>
  compactSession(config: RuntimeCompactConfig): Promise<RuntimeCompactResult>
  labelSessionEntry(config: RuntimeLabelConfig): Promise<RuntimeLabelResult>
  abortSessionOperation(operationId: string): void
  reloadResources(sessionId: string): Promise<void>
  getRuntimeControls?(sessionId: string): Promise<{
    modelId: string | null
    thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    activeTools: string[]
    availableTools: string[]
    steeringMode: 'all' | 'one-at-a-time'
    followUpMode: 'all' | 'one-at-a-time'
  } | null>
  setRuntimeControls?(
    sessionId: string,
    controls: {
      modelId: string | null
      thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
      activeTools: string[]
      steeringMode: 'all' | 'one-at-a-time'
      followUpMode: 'all' | 'one-at-a-time'
    },
  ): Promise<void>
  stop(runId: string): void
  respondToExtensionUi(sessionId: string, requestId: string, value: string | boolean | null): void
  updateComposerText?(sessionId: string, text: string): void
  queueMessage(runId: string, mode: 'steer' | 'follow-up', message: string): void
  clearQueue(runId: string): void
  isActive(): boolean
}

interface ActiveRun {
  session: SessionRecord
  runId: string
  assistantMessageId: string
  redactor: SecretRedactor
}

export interface SessionNavigationResult {
  history: SessionHistoryView
  editorText: string | null
  summaryCreated: boolean
}

export class RuntimeCoordinator {
  private active: ActiveRun | null = null
  private sessionOperationId: string | null = null
  private cancellableSessionOperation: { operationId: string; sessionId: string } | null = null
  private persistenceQueue = Promise.resolve()
  private readonly replacementTransactions = new Map<
    string,
    {
      sourceSessionId: string
      targetSessionId: string
      kind: 'new' | 'fork' | 'switch'
      targetProjectId?: string
    }
  >()

  constructor(
    private readonly repository: RuntimePersistence,
    private readonly supervisor: RuntimeHost,
    private readonly broadcast: (event: RuntimeEvent) => void,
  ) {}

  async selectContext(projectId: string | null, sessionId: string | null): Promise<void> {
    if (this.active || this.sessionOperationId || this.supervisor.isActive()) {
      throw new PictorError('invalid-input', '已有 Runtime 操作正在执行，请等待其完成')
    }
    await this.persistenceQueue

    if (projectId === null || sessionId === null) {
      if (projectId !== null) this.repository.getProject(projectId)
      await this.supervisor.closeSession?.()
      await this.repository.selectContext?.(projectId, sessionId)
      return
    }

    const session = await this.repository.getSession(sessionId)
    if (session.projectId !== projectId) {
      throw new PictorError('invalid-input', '会话不属于所选项目')
    }
    const history = this.repository.getSessionHistory(sessionId)
    if (history.authority === 'pi-jsonl') {
      if (this.supervisor.openSession) {
        const settings = await this.repository.getSettings()
        const apiKey = await this.repository.getApiKey()
        if (settings && apiKey) {
          await this.supervisor.openSession(
            await this.createSessionOpenConfig(sessionId, randomUUID()),
          )
          await this.persistenceQueue
        } else {
          await this.supervisor.closeSession?.()
        }
      }
    } else {
      await this.supervisor.closeSession?.()
    }
    await this.repository.selectContext?.(projectId, sessionId)
  }

  async removeProject(projectId: string): Promise<void> {
    if (this.active || this.sessionOperationId || this.supervisor.isActive()) {
      throw new PictorError('invalid-input', '已有 Runtime 操作正在执行，请等待其完成')
    }
    await this.persistenceQueue
    const previous = this.repository.getSelectedContext()
    const affectsOpenedSession = previous.projectId === projectId
    if (affectsOpenedSession) await this.supervisor.closeSession?.()
    try {
      await this.repository.removeProject(projectId)
    } catch (error) {
      if (affectsOpenedSession && previous.projectId) {
        await this.selectContext(previous.projectId, previous.sessionId).catch(() => undefined)
      }
      throw error
    }
    if (affectsOpenedSession) await this.openSelectedContext()
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (this.active || this.sessionOperationId || this.supervisor.isActive()) {
      throw new PictorError('invalid-input', '已有 Runtime 操作正在执行，请等待其完成')
    }
    await this.persistenceQueue
    const previous = this.repository.getSelectedContext()
    const affectsOpenedSession = previous.sessionId === sessionId
    if (affectsOpenedSession) await this.supervisor.closeSession?.()
    try {
      await this.repository.deleteSession(sessionId)
    } catch (error) {
      if (affectsOpenedSession && previous.projectId) {
        await this.selectContext(previous.projectId, previous.sessionId).catch(() => undefined)
      }
      throw error
    }
    if (affectsOpenedSession) await this.openSelectedContext()
  }

  async start(
    sessionId: string,
    prompt: string,
    images: ImageAttachment[] = [],
  ): Promise<{ runId: string }> {
    if (this.active || this.sessionOperationId || this.supervisor.isActive()) {
      throw new PictorError('invalid-input', '已有 Agent 运行正在执行，请先等待或停止该运行')
    }
    const session = await this.repository.getSession(sessionId)
    const history = this.repository.getSessionHistory(sessionId)
    if (history.authority === 'legacy-import') {
      throw new PictorError(
        'invalid-input',
        '此会话是旧版只读历史；请先显式导入为 Pi Session，或新建 Session 继续工作',
      )
    }
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
        images,
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
        sessionName: session.title,
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
        prompt: sanitizedPrompt,
        ...(images.length > 0 ? { images } : {}),
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

  async forkSession(sourceSessionId: string, entryId: string): Promise<SessionSummary | null> {
    return this.deriveSession(sourceSessionId, { kind: 'fork', entryId })
  }

  async cloneSession(sourceSessionId: string): Promise<SessionSummary | null> {
    return this.deriveSession(sourceSessionId, { kind: 'clone' })
  }

  async navigateSessionTree(
    sourceSessionId: string,
    entryId: string,
    options: { summarize: boolean; customInstructions: string | null } = {
      summarize: false,
      customInstructions: null,
    },
  ): Promise<SessionNavigationResult | null> {
    if (this.active || this.sessionOperationId || this.supervisor.isActive()) {
      throw new PictorError('invalid-input', '已有 Runtime 操作正在执行，请等待其完成')
    }
    await this.persistenceQueue
    const source = await this.repository.getSession(sourceSessionId)
    const history = this.repository.getSessionHistory(sourceSessionId)
    if (history.authority !== 'pi-jsonl' || !history.piSessionPath) {
      throw new PictorError('invalid-input', '当前 Session 没有可导航的 Pi JSONL 历史')
    }
    const historyView = await this.repository.inspectSessionHistory(sourceSessionId, entryId)
    const tree = historyView.tree
    if (!tree?.activeLeafId) {
      throw new PictorError('invalid-input', '当前 Pi Session History 没有活跃节点')
    }
    if (entryId === tree.activeLeafId) {
      throw new PictorError('invalid-input', '当前节点已经是活跃节点')
    }
    const target = tree.nodes.find((node) => node.id === entryId)
    if (!target) throw new PictorError('not-found', '目标 Pi Session 节点不存在')
    const project = this.repository.getProject(source.projectId)
    if (project.availability !== 'available') {
      throw new PictorError('project-unavailable', '项目目录当前不可用，请重新关联后再导航')
    }
    const settings = await this.repository.getSettings()
    const apiKey = await this.repository.getApiKey()
    if (!settings || !apiKey) {
      throw new PictorError('invalid-input', '请先保存完整的模型 API 设置')
    }
    const sourcePaths = this.repository.getRuntimePaths(project.id, sourceSessionId)
    if (!sourcePaths.resumeSession) {
      throw new PictorError(
        'credential-unavailable',
        'Pi Session 凭据迁移尚未完成，当前历史不能安全导航',
      )
    }

    const operationId = randomUUID()
    this.sessionOperationId = operationId
    if (options.summarize) {
      this.cancellableSessionOperation = { operationId, sessionId: sourceSessionId }
    }
    try {
      const result = await this.supervisor.navigateSession({
        type: 'navigate',
        operationId,
        sourceSessionId,
        entryId,
        summarize: options.summarize,
        customInstructions: options.customInstructions,
        activeLeafId: tree.activeLeafId,
        projectRoot: project.rootPath,
        agentDirectory: sourcePaths.agentDirectory,
        sourcePiSessionPath: history.piSessionPath,
        settings: {
          apiProtocol: settings.apiProtocol,
          baseUrl: settings.baseUrl,
          modelId: settings.modelId,
          reasoningEffort: settings.reasoningEffort,
          temperature: settings.temperature,
          maxOutputTokens: settings.maxOutputTokens,
        },
        apiKey,
      })
      if (result.outcome === 'cancelled') return null
      if (result.outcome === 'failed') throw new Error(result.message)
      await this.repository.setPiSessionActiveLeaf(sourceSessionId, result.activeLeafId)
      await this.repository.rebuildSessionProjection(sourceSessionId)
      return {
        history: await this.repository.inspectSessionHistory(sourceSessionId, null),
        editorText: result.editorText,
        summaryCreated: result.summaryCreated,
      }
    } finally {
      if (this.sessionOperationId === operationId) this.sessionOperationId = null
      if (this.cancellableSessionOperation?.operationId === operationId) {
        this.cancellableSessionOperation = null
      }
    }
  }

  async compactSession(
    sourceSessionId: string,
    customInstructions: string | null,
  ): Promise<SessionHistoryView | null> {
    if (this.active || this.sessionOperationId || this.supervisor.isActive()) {
      throw new PictorError('invalid-input', '已有 Runtime 操作正在执行，请等待其完成')
    }
    await this.persistenceQueue
    const source = await this.repository.getSession(sourceSessionId)
    const history = this.repository.getSessionHistory(sourceSessionId)
    if (history.authority !== 'pi-jsonl' || !history.piSessionPath) {
      throw new PictorError('invalid-input', '当前 Session 没有可压缩的 Pi JSONL 历史')
    }
    const historyView = await this.repository.inspectSessionHistory(sourceSessionId, null)
    const activeLeafId = historyView.tree?.activeLeafId
    if (!activeLeafId) {
      throw new PictorError('invalid-input', '当前 Pi Session History 没有活跃节点')
    }
    const project = this.repository.getProject(source.projectId)
    if (project.availability !== 'available') {
      throw new PictorError('project-unavailable', '项目目录当前不可用，请重新关联后再压缩')
    }
    const settings = await this.repository.getSettings()
    const apiKey = await this.repository.getApiKey()
    if (!settings || !apiKey) {
      throw new PictorError('invalid-input', '请先保存完整的模型 API 设置')
    }
    const sourcePaths = this.repository.getRuntimePaths(project.id, sourceSessionId)
    if (!sourcePaths.resumeSession) {
      throw new PictorError(
        'credential-unavailable',
        'Pi Session 凭据迁移尚未完成，当前历史不能安全压缩',
      )
    }

    const operationId = randomUUID()
    this.sessionOperationId = operationId
    this.cancellableSessionOperation = { operationId, sessionId: sourceSessionId }
    try {
      const result = await this.supervisor.compactSession({
        type: 'compact',
        operationId,
        sourceSessionId,
        customInstructions,
        activeLeafId: activeLeafId ?? null,
        projectRoot: project.rootPath,
        agentDirectory: sourcePaths.agentDirectory,
        sourcePiSessionPath: history.piSessionPath,
        settings: {
          apiProtocol: settings.apiProtocol,
          baseUrl: settings.baseUrl,
          modelId: settings.modelId,
          reasoningEffort: settings.reasoningEffort,
          temperature: settings.temperature,
          maxOutputTokens: settings.maxOutputTokens,
        },
        apiKey,
      })
      if (result.outcome === 'cancelled') return null
      if (result.outcome === 'failed') throw new Error(result.message)
      await this.repository.setPiSessionActiveLeaf(sourceSessionId, result.activeLeafId)
      await this.repository.rebuildSessionProjection(sourceSessionId)
      return this.repository.inspectSessionHistory(sourceSessionId, null)
    } finally {
      if (this.sessionOperationId === operationId) this.sessionOperationId = null
      if (this.cancellableSessionOperation?.operationId === operationId) {
        this.cancellableSessionOperation = null
      }
    }
  }

  async labelSessionEntry(
    sourceSessionId: string,
    entryId: string,
    label: string | null,
  ): Promise<SessionHistoryView> {
    if (this.active || this.sessionOperationId || this.supervisor.isActive()) {
      throw new PictorError('invalid-input', '已有 Runtime 操作正在执行，请等待其完成')
    }
    const source = await this.repository.getSession(sourceSessionId)
    const history = this.repository.getSessionHistory(sourceSessionId)
    if (history.authority !== 'pi-jsonl' || !history.piSessionPath) {
      throw new PictorError('invalid-input', '当前 Session 没有可标记的 Pi JSONL 历史')
    }
    const inspected = await this.repository.inspectSessionHistory(sourceSessionId, entryId)
    const activeLeafId = inspected.tree?.activeLeafId
    if (!inspected.tree?.nodes.some((node) => node.id === entryId)) {
      throw new PictorError('not-found', '目标 Pi Session 节点不存在')
    }
    const project = this.repository.getProject(source.projectId)
    const settings = await this.repository.getSettings()
    const apiKey = await this.repository.getApiKey()
    if (!settings || !apiKey) {
      throw new PictorError('invalid-input', '请先保存完整的模型 API 设置')
    }
    const paths = this.repository.getRuntimePaths(project.id, sourceSessionId)
    const operationId = randomUUID()
    this.sessionOperationId = operationId
    try {
      const result = await this.supervisor.labelSessionEntry({
        type: 'label',
        operationId,
        sourceSessionId,
        entryId,
        label,
        activeLeafId: activeLeafId ?? null,
        projectRoot: project.rootPath,
        agentDirectory: paths.agentDirectory,
        sourcePiSessionPath: history.piSessionPath,
        settings: {
          apiProtocol: settings.apiProtocol,
          baseUrl: settings.baseUrl,
          modelId: settings.modelId,
          reasoningEffort: settings.reasoningEffort,
          temperature: settings.temperature,
          maxOutputTokens: settings.maxOutputTokens,
        },
        apiKey,
      })
      if (result.outcome === 'failed') throw new Error(result.message)
      await this.repository.setPiSessionActiveLeaf(sourceSessionId, result.activeLeafId)
      await this.repository.rebuildSessionProjection(sourceSessionId)
      return this.repository.inspectSessionHistory(sourceSessionId, null)
    } finally {
      if (this.sessionOperationId === operationId) this.sessionOperationId = null
    }
  }

  cancelSessionOperation(sessionId: string): boolean {
    const operation = this.cancellableSessionOperation
    if (!operation || operation.sessionId !== sessionId) return false
    this.supervisor.abortSessionOperation(operation.operationId)
    return true
  }

  async reloadSessionResources(sessionId: string): Promise<void> {
    if (this.active || this.sessionOperationId || this.supervisor.isActive()) {
      throw new PictorError('invalid-input', '已有 Runtime 操作正在执行，请等待其完成')
    }
    const history = this.repository.getSessionHistory(sessionId)
    if (history.authority !== 'pi-jsonl' || !history.piSessionPath) {
      throw new PictorError('invalid-input', '当前 Session 没有可重载的 Pi Runtime 资源')
    }
    await this.supervisor.reloadResources(sessionId)
    await this.persistenceQueue
  }

  async getSessionRuntimeControls(sessionId: string): Promise<{
    modelId: string
    thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    activeTools: string[]
    availableTools: string[]
    steeringMode: 'all' | 'one-at-a-time'
    followUpMode: 'all' | 'one-at-a-time'
  }> {
    const live = await this.supervisor.getRuntimeControls?.(sessionId)
    const settings = await this.repository.getSettings()
    if (!settings) throw new PictorError('invalid-input', '请先保存完整的模型 API 设置')
    if (live) return { ...live, modelId: live.modelId ?? settings.modelId }
    const history = this.repository.getSessionHistory(sessionId)
    const preferences = history.runtimePreferences
    return {
      modelId: preferences?.modelId ?? settings.modelId,
      thinkingLevel: preferences?.thinkingLevel ?? settings.reasoningEffort ?? 'off',
      activeTools: preferences?.activeTools ?? defaultRuntimeTools,
      availableTools: defaultRuntimeTools,
      steeringMode: preferences?.steeringMode ?? 'one-at-a-time',
      followUpMode: preferences?.followUpMode ?? 'one-at-a-time',
    }
  }

  async setSessionRuntimeControls(
    sessionId: string,
    controls: {
      modelId: string
      thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
      activeTools: string[]
      steeringMode: 'all' | 'one-at-a-time'
      followUpMode: 'all' | 'one-at-a-time'
    },
  ): Promise<void> {
    if (!this.repository.setSessionRuntimePreferences) {
      throw new PictorError('persistence-failed', 'Session Controls 持久化接口不可用')
    }
    await this.supervisor.setRuntimeControls?.(sessionId, controls)
    await this.persistenceQueue
    await this.repository.setSessionRuntimePreferences(sessionId, controls)
  }

  private async createSessionOpenConfig(
    sessionId: string,
    operationId: string,
  ): Promise<RuntimeSessionOpenConfig> {
    const session = await this.repository.getSession(sessionId)
    const history = this.repository.getSessionHistory(sessionId)
    if (history.authority !== 'pi-jsonl') {
      throw new PictorError('invalid-input', '当前 Session 没有可打开的 Pi JSONL 历史')
    }
    const project = this.repository.getProject(session.projectId)
    if (project.availability !== 'available') {
      throw new PictorError('project-unavailable', '项目目录当前不可用，请重新关联或移除项目')
    }
    const settings = await this.repository.getSettings()
    const apiKey = await this.repository.getApiKey()
    if (!settings || !apiKey) {
      throw new PictorError('invalid-input', '请先保存完整的模型 API 设置')
    }
    const runtimePaths = this.repository.getRuntimePaths(project.id, session.id)
    return {
      type: 'session.open',
      operationId,
      sessionId: session.id,
      sessionName: session.title,
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
    }
  }

  private async openSelectedContext(): Promise<void> {
    const selected = this.repository.getSelectedContext()
    if (!selected.projectId) return
    await this.selectContext(selected.projectId, selected.sessionId)
  }

  private async deriveSession(
    sourceSessionId: string,
    derivation: { kind: 'fork'; entryId: string } | { kind: 'clone' },
  ): Promise<SessionSummary | null> {
    if (this.active || this.sessionOperationId || this.supervisor.isActive()) {
      throw new PictorError('invalid-input', '已有 Runtime 操作正在执行，请等待其完成')
    }
    await this.persistenceQueue
    const source = await this.repository.getSession(sourceSessionId)
    const history = this.repository.getSessionHistory(sourceSessionId)
    if (history.authority !== 'pi-jsonl' || !history.piSessionPath) {
      throw new PictorError('invalid-input', '当前 Session 没有可派生的 Pi JSONL 历史')
    }
    const historyView = await this.repository.inspectSessionHistory(
      sourceSessionId,
      derivation.kind === 'fork' ? derivation.entryId : null,
    )
    const activeLeafId = historyView.tree?.activeLeafId
    if (!activeLeafId) {
      throw new PictorError('invalid-input', '当前 Pi Session History 没有可派生的活跃节点')
    }
    if (derivation.kind === 'fork' && derivation.entryId === activeLeafId) {
      throw new PictorError('invalid-input', '当前节点是活跃叶节点，请使用 Clone 复制当前分支')
    }
    const entryId = derivation.kind === 'clone' ? activeLeafId : derivation.entryId
    const actionLabel = derivation.kind === 'clone' ? 'Clone' : 'Fork'
    const project = this.repository.getProject(source.projectId)
    if (project.availability !== 'available') {
      throw new PictorError(
        'project-unavailable',
        `项目目录当前不可用，请重新关联后再 ${actionLabel}`,
      )
    }
    const settings = await this.repository.getSettings()
    const apiKey = await this.repository.getApiKey()
    if (!settings || !apiKey) {
      throw new PictorError('invalid-input', '请先保存完整的模型 API 设置')
    }

    const operationId = randomUUID()
    const targetSessionId = randomUUID()
    const sourcePaths = this.repository.getRuntimePaths(project.id, sourceSessionId)
    if (!sourcePaths.resumeSession) {
      throw new PictorError(
        'credential-unavailable',
        `Pi Session 凭据迁移尚未完成，当前历史不能安全 ${actionLabel}`,
      )
    }
    this.sessionOperationId = operationId
    try {
      const result = await this.supervisor.fork({
        type: 'fork',
        operationId,
        sourceSessionId,
        targetSessionId,
        entryId,
        projectRoot: project.rootPath,
        agentDirectory: sourcePaths.agentDirectory,
        sourcePiSessionPath: history.piSessionPath,
        settings: {
          apiProtocol: settings.apiProtocol,
          baseUrl: settings.baseUrl,
          modelId: settings.modelId,
          reasoningEffort: settings.reasoningEffort,
          temperature: settings.temperature,
          maxOutputTokens: settings.maxOutputTokens,
        },
        apiKey,
      })
      if (result.outcome === 'cancelled') return null
      if (result.outcome === 'failed') throw new Error(result.message)
      return await this.repository.createDerivedSession(
        sourceSessionId,
        targetSessionId,
        derivation.kind,
        {
          id: result.piSessionId,
          path: result.piSessionPath,
        },
      )
    } finally {
      if (this.sessionOperationId === operationId) {
        this.sessionOperationId = null
      }
    }
  }

  async importSession(projectId: string, sourceJsonlPath: string): Promise<SessionSummary | null> {
    if (this.active || this.sessionOperationId || this.supervisor.isActive()) {
      throw new PictorError('invalid-input', '已有 Runtime 操作正在执行，请等待其完成')
    }
    if (!isAbsolute(sourceJsonlPath) || extname(sourceJsonlPath).toLowerCase() !== '.jsonl') {
      throw new PictorError('invalid-input', '请选择有效的 Pi Session JSONL 文件')
    }
    await this.persistenceQueue
    const project = this.repository.getProject(projectId)
    if (project.availability !== 'available') {
      throw new PictorError('project-unavailable', '项目目录当前不可用，请重新关联后再 Import')
    }
    const settings = await this.repository.getSettings()
    const apiKey = await this.repository.getApiKey()
    if (!settings || !apiKey) {
      throw new PictorError('invalid-input', '请先保存完整的模型 API 设置')
    }

    const operationId = randomUUID()
    const targetSessionId = randomUUID()
    const targetPaths = this.repository.getRuntimePaths(project.id, targetSessionId)
    const fileName = basename(sourceJsonlPath)
    const sourceTitle = fileName.slice(0, -extname(fileName).length).trim() || 'Imported Session'
    this.sessionOperationId = operationId
    try {
      const result = await this.supervisor.importSession({
        type: 'import',
        operationId,
        targetSessionId,
        projectRoot: project.rootPath,
        agentDirectory: targetPaths.agentDirectory,
        sourceJsonlPath,
        targetSessionDirectory: targetPaths.sessionDirectory,
        settings: {
          apiProtocol: settings.apiProtocol,
          baseUrl: settings.baseUrl,
          modelId: settings.modelId,
          reasoningEffort: settings.reasoningEffort,
          temperature: settings.temperature,
          maxOutputTokens: settings.maxOutputTokens,
        },
        apiKey,
      })
      if (result.outcome === 'cancelled') return null
      if (result.outcome === 'failed') throw new Error(result.message)
      return await this.repository.createImportedSession(
        project.id,
        targetSessionId,
        `${sourceTitle} (Import)`.slice(0, 120),
        { id: result.piSessionId, path: result.piSessionPath },
      )
    } finally {
      if (this.sessionOperationId === operationId) this.sessionOperationId = null
    }
  }

  async exportSession(
    sourceSessionId: string,
    format: SessionExportFormat,
    destinationPath: string,
  ): Promise<void> {
    if (this.active || this.sessionOperationId || this.supervisor.isActive()) {
      throw new PictorError('invalid-input', '已有 Runtime 操作正在执行，请等待其完成')
    }
    const expectedExtension = format === 'jsonl' ? '.jsonl' : '.html'
    if (
      !isAbsolute(destinationPath) ||
      extname(destinationPath).toLowerCase() !== expectedExtension
    ) {
      throw new PictorError('invalid-input', `请选择有效的 ${expectedExtension} 导出位置`)
    }
    await this.persistenceQueue
    const source = await this.repository.getSession(sourceSessionId)
    const history = this.repository.getSessionHistory(sourceSessionId)
    if (history.authority !== 'pi-jsonl' || !history.piSessionPath) {
      throw new PictorError('invalid-input', '当前 Session 没有可导出的 Pi JSONL 历史')
    }
    const project = this.repository.getProject(source.projectId)
    if (project.availability !== 'available') {
      throw new PictorError('project-unavailable', '项目目录当前不可用，请重新关联后再 Export')
    }
    const settings = await this.repository.getSettings()
    const apiKey = await this.repository.getApiKey()
    if (!settings || !apiKey) {
      throw new PictorError('invalid-input', '请先保存完整的模型 API 设置')
    }
    const sourcePaths = this.repository.getRuntimePaths(project.id, sourceSessionId)
    if (!sourcePaths.resumeSession) {
      throw new PictorError(
        'credential-unavailable',
        'Pi Session 凭据迁移尚未完成，当前历史不能安全 Export',
      )
    }

    const operationId = randomUUID()
    this.sessionOperationId = operationId
    try {
      const result = await this.supervisor.exportSession({
        type: 'export',
        operationId,
        sourceSessionId,
        format,
        projectRoot: project.rootPath,
        agentDirectory: sourcePaths.agentDirectory,
        sourcePiSessionPath: history.piSessionPath,
        ...(history.activeLeafId !== undefined ? { activeLeafId: history.activeLeafId } : {}),
        destinationPath,
        settings: {
          apiProtocol: settings.apiProtocol,
          baseUrl: settings.baseUrl,
          modelId: settings.modelId,
          reasoningEffort: settings.reasoningEffort,
          temperature: settings.temperature,
          maxOutputTokens: settings.maxOutputTokens,
        },
        apiKey,
      })
      if (result.outcome === 'failed') throw new Error(result.message)
    } finally {
      if (this.sessionOperationId === operationId) this.sessionOperationId = null
    }
  }

  stop(runId: string): void {
    this.supervisor.stop(runId)
  }

  respondToExtensionUi(sessionId: string, requestId: string, value: string | boolean | null): void {
    this.supervisor.respondToExtensionUi(sessionId, requestId, value)
  }

  updateComposerText(sessionId: string, text: string): void {
    this.supervisor.updateComposerText?.(sessionId, text)
  }

  queueMessage(runId: string, mode: 'steer' | 'follow-up', message: string): void {
    this.supervisor.queueMessage(runId, mode, message)
  }

  clearQueue(runId: string): void {
    this.supervisor.clearQueue(runId)
  }

  async handleSessionReplacementRequest(
    request: RuntimeSessionReplacementRequest,
  ): Promise<{ accepted: boolean; targetSessionId?: string; message?: string }> {
    if (request.phase === 'prepare') {
      let targetSessionId = request.targetSessionId
      let targetProjectId: string | undefined
      if (request.kind === 'switch' && request.targetSessionPath) {
        const existing = await this.repository.findSessionByPiSessionPath?.(
          request.targetSessionPath,
        )
        if (existing) {
          targetSessionId = existing.id
          targetProjectId = existing.projectId
        }
      }
      if (!this.repository.prepareSessionReplacement) {
        return { accepted: false, message: 'Session replacement journal is unavailable' }
      }
      try {
        await this.repository.prepareSessionReplacement({
          operationId: request.operationId,
          sourceSessionId: request.sourceSessionId,
          targetSessionId,
          kind: request.kind,
          ...(targetProjectId ? { targetProjectId } : {}),
          targetSessionPath: request.targetSessionPath,
          sourcePiSessionPath: request.sourcePiSessionPath,
        })
      } catch (error) {
        return {
          accepted: false,
          message: error instanceof Error ? error.message : 'Session replacement prepare failed',
        }
      }
      this.replacementTransactions.set(request.operationId, {
        sourceSessionId: request.sourceSessionId,
        targetSessionId,
        kind: request.kind,
        ...(targetProjectId ? { targetProjectId } : {}),
      })
      return { accepted: true, targetSessionId }
    }

    const transaction = this.replacementTransactions.get(request.operationId)
    if (request.phase === 'abort') {
      if (
        transaction &&
        (transaction.sourceSessionId !== request.sourceSessionId ||
          transaction.targetSessionId !== request.targetSessionId ||
          transaction.kind !== request.kind)
      ) {
        return { accepted: false, message: 'Session replacement transaction is unknown' }
      }
      try {
        await this.repository.abortSessionReplacement?.(request.operationId)
        this.replacementTransactions.delete(request.operationId)
        return { accepted: true }
      } catch (error) {
        return {
          accepted: false,
          message: error instanceof Error ? error.message : 'Session replacement abort failed',
        }
      }
    }

    if (
      !transaction ||
      transaction.sourceSessionId !== request.sourceSessionId ||
      transaction.targetSessionId !== request.targetSessionId ||
      transaction.kind !== request.kind
    ) {
      return { accepted: false, message: 'Session replacement transaction is unknown' }
    }
    if (!request.piSessionId || !request.piSessionPath) {
      return { accepted: false, message: 'Pi Session replacement returned no identity' }
    }
    try {
      let targetProjectId = transaction.targetProjectId
      if (!targetProjectId && request.cwd) {
        const project = this.repository.ensureProjectByPath
          ? await this.repository.ensureProjectByPath(request.cwd).catch(() => null)
          : this.repository.findProjectByPath
            ? await this.repository.findProjectByPath(request.cwd).catch(() => null)
            : null
        targetProjectId = project?.id
      }
      if (!targetProjectId && !request.cwd && request.kind !== 'switch') {
        targetProjectId = (await this.repository.getSession(transaction.sourceSessionId)).projectId
      }
      if (!targetProjectId) {
        return { accepted: false, message: 'Pi Session replacement target Project is unavailable' }
      }
      if (!this.repository.commitSessionReplacement) {
        return { accepted: false, message: 'Session replacement persistence is unavailable' }
      }
      await this.repository.commitSessionReplacement(
        request.operationId,
        transaction.sourceSessionId,
        transaction.targetSessionId,
        transaction.kind,
        { id: request.piSessionId, path: request.piSessionPath },
        targetProjectId,
        request.cwd ?? undefined,
      )
      this.replacementTransactions.delete(request.operationId)
      return { accepted: true }
    } catch (error) {
      return {
        accepted: false,
        message: error instanceof Error ? error.message : 'Session replacement commit failed',
      }
    }
  }

  isActive(): boolean {
    return this.active !== null || this.sessionOperationId !== null || this.supervisor.isActive()
  }

  handleEvent(event: RuntimeEvent): void {
    const active = this.active
    const sanitizedEvent = active ? active.redactor.redactRuntimeEvent(event) : event
    if (sanitizedEvent.runId === null) {
      this.handleSessionEvent(sanitizedEvent)
      return
    }
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
    if (sanitizedEvent.type === 'session.bound') {
      this.broadcast(sanitizedEvent)
      this.persistenceQueue = this.persistenceQueue
        .then(() =>
          this.repository.bindPiSession(sanitizedEvent.sessionId, {
            id: sanitizedEvent.piSessionId,
            path: sanitizedEvent.piSessionPath,
          }),
        )
        .catch(() =>
          this.broadcast({
            type: 'runtime.error',
            runId: sanitizedEvent.runId,
            sessionId: sanitizedEvent.sessionId,
            at: new Date().toISOString(),
            category: 'runtime',
            message: 'Pi Session identity 无法写入本地存储，请停止当前任务并检查磁盘权限',
          }),
        )
      return
    }
    if (sanitizedEvent.type === 'session.activeLeafChanged') {
      this.persistenceQueue = this.persistenceQueue
        .then(() =>
          this.repository.setPiSessionActiveLeaf(active.session.id, sanitizedEvent.activeLeafId),
        )
        .then(() => this.broadcast(sanitizedEvent))
        .catch(() =>
          this.broadcast({
            type: 'runtime.error',
            runId: sanitizedEvent.runId,
            sessionId: sanitizedEvent.sessionId,
            at: new Date().toISOString(),
            category: 'runtime',
            message: 'Pi Session 活跃分支持久化失败',
          }),
        )
      return
    }
    this.applyEvent(active, sanitizedEvent)
    if (
      sanitizedEvent.type === 'message.delta' ||
      sanitizedEvent.type === 'message.completed' ||
      sanitizedEvent.type === 'tool.updated' ||
      sanitizedEvent.type === 'extension.ui.requested'
    ) {
      this.broadcast(sanitizedEvent)
    } else {
      const sessionSnapshot = terminalEvent ? null : sessionRecordSchema.parse(active.session)
      this.persistenceQueue = this.persistenceQueue
        .then(() => {
          if (sessionSnapshot) return this.repository.saveSession(sessionSnapshot)
          const history = this.repository.getSessionHistory(active.session.id)
          return history.authority === 'pi-jsonl' && history.piSessionPath
            ? this.repository.rebuildSessionProjection(active.session.id)
            : this.repository.saveSession(active.session)
        })
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

  private handleSessionEvent(event: RuntimeEvent): void {
    if (event.runId !== null) return
    if (event.type === 'session.bound') {
      this.broadcast(event)
      this.persistenceQueue = this.persistenceQueue
        .then(() =>
          this.repository.bindPiSession(event.sessionId, {
            id: event.piSessionId,
            path: event.piSessionPath,
          }),
        )
        .catch(() =>
          this.broadcast({
            type: 'runtime.error',
            runId: null,
            sessionId: event.sessionId,
            at: new Date().toISOString(),
            category: 'runtime',
            message: 'Pi Session identity 无法写入本地存储，请检查磁盘权限',
          }),
        )
      return
    }
    if (event.type === 'session.activeLeafChanged') {
      this.persistenceQueue = this.persistenceQueue
        .then(() => this.repository.setPiSessionActiveLeaf(event.sessionId, event.activeLeafId))
        .then(() => this.broadcast(event))
        .catch(() =>
          this.broadcast({
            type: 'runtime.error',
            runId: null,
            sessionId: event.sessionId,
            at: new Date().toISOString(),
            category: 'runtime',
            message: 'Pi Session 活跃分支持久化失败',
          }),
        )
      return
    }
    if (event.type === 'session.infoChanged') {
      this.persistenceQueue = this.persistenceQueue
        .then(async () => {
          const session = await this.repository.getSession(event.sessionId)
          if (event.name) session.title = event.name
          session.updatedAt = event.at
          return this.repository.saveSession(session)
        })
        .then(() => this.broadcast(event))
        .catch(() =>
          this.broadcast({
            type: 'runtime.error',
            runId: null,
            sessionId: event.sessionId,
            at: new Date().toISOString(),
            category: 'runtime',
            message: 'Pi Session 名称持久化失败',
          }),
        )
      return
    }
    this.broadcast(event)
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
    if (event.type === 'runtime.error') {
      run.error = event.message
      run.updatedAt = event.at
    }
  }
}
