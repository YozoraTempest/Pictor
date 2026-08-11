import { mkdir } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'

import { runtimeEventSchema, type RuntimeEvent } from '../../src/shared/contracts.js'
import { ApprovalBroker } from './approval-broker.js'
import { GitBashCommandExecutor, type CommandExecutor } from './command-executor.js'
import { ProjectPathGuard } from './path-guard.js'
import type { RuntimeStartConfig } from './protocol.js'
import { createPictorTools } from './tools.js'

const PROVIDER_ID = 'pictor-openai-compatible'

const toolKinds = {
  pictor_list: 'list',
  pictor_search: 'search',
  pictor_read: 'read',
  pictor_write: 'write',
  pictor_edit: 'edit',
  pictor_move: 'move',
  pictor_delete: 'delete',
  pictor_command: 'command',
} as const

interface PiSessionLike {
  subscribe(listener: (event: AgentSessionEvent) => void): () => void
  prompt(text: string, options?: { expandPromptTemplates?: boolean }): Promise<void>
  abort(): Promise<void>
  waitForIdle(): Promise<void>
  dispose(): void
}

interface SessionFactoryInput {
  config: RuntimeStartConfig
  tools: ToolDefinition[]
}

type SessionFactory = (input: SessionFactoryInput) => Promise<PiSessionLike>

interface ActiveRuntime {
  config: RuntimeStartConfig
  approvals: ApprovalBroker
  abortController: AbortController
  session: PiSessionLike | null
  unsubscribe: (() => void) | null
  cancelled: boolean
  text: string
  failure: RuntimeFailure | null
}

type RuntimeFailure = Pick<Extract<RuntimeEvent, { type: 'runtime.error' }>, 'category' | 'message'>

type RuntimeEventPayload = RuntimeEvent extends infer Event
  ? Event extends RuntimeEvent
    ? Omit<Event, 'runId' | 'sessionId' | 'at'>
    : never
  : never

function eventText(value: unknown): string {
  if (!value || typeof value !== 'object' || !('content' in value)) return ''
  const content = Reflect.get(value, 'content')
  if (!Array.isArray(content)) return ''
  return content
    .filter(
      (block): block is { type: 'text'; text: string } =>
        typeof block === 'object' &&
        block !== null &&
        Reflect.get(block, 'type') === 'text' &&
        typeof Reflect.get(block, 'text') === 'string',
    )
    .map((block) => block.text)
    .join('')
}

function outputText(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  return eventText(value)
}

function classifyError(message: string): RuntimeFailure['category'] {
  const normalized = message.toLocaleLowerCase('en-US')
  if (normalized.includes('401') || normalized.includes('403') || normalized.includes('api key')) {
    return 'authentication'
  }
  if (normalized.includes('429') || /\b5\d\d\b/.test(normalized)) return 'server'
  if (normalized.includes('404') || normalized.includes('model')) return 'model'
  if (
    normalized.includes('network') ||
    normalized.includes('fetch') ||
    normalized.includes('connect') ||
    normalized.includes('timeout') ||
    normalized.includes('terminated') ||
    normalized.includes('socket') ||
    normalized.includes('econnreset') ||
    normalized.includes('stream ended') ||
    normalized.includes('stream closed')
  ) {
    return 'connectivity'
  }
  return 'runtime'
}

const categoryMessages: Record<RuntimeFailure['category'], string> = {
  authentication: '模型认证失败：请检查 API Key 和端点权限后重试。',
  connectivity: '模型连接中断：请检查网络和 API Base URL 后重试。',
  model: '模型不可用：请检查模型标识及该端点的模型权限。',
  server: '模型服务暂时不可用或请求受限：请稍后重试。',
  runtime: '模型响应无法处理：请检查兼容模式和服务端 SSE 格式。',
}

function runtimeFailure(detail: string): RuntimeFailure {
  const category = classifyError(detail)
  return { category, message: `${categoryMessages[category]} 技术详情：${detail}` }
}

function toolPath(projectRoot: string, args: unknown): string | null {
  if (!args || typeof args !== 'object') return null
  const displayPath = (value: unknown): string | null => {
    if (typeof value !== 'string') return null
    const candidate = isAbsolute(value) ? resolve(value) : resolve(projectRoot, value)
    const display = relative(projectRoot, candidate)
    return display && !display.startsWith('..') && !isAbsolute(display) ? display : value
  }
  const path = displayPath(Reflect.get(args, 'path'))
  if (path) return path
  const source = displayPath(Reflect.get(args, 'sourcePath'))
  const destination = displayPath(Reflect.get(args, 'destinationPath'))
  return source && destination ? `${source} -> ${destination}` : (source ?? destination)
}

async function createProductionSession({
  config,
  tools,
}: SessionFactoryInput): Promise<AgentSession> {
  await mkdir(config.agentDirectory, { recursive: true })
  await mkdir(config.sessionDirectory, { recursive: true })
  const settingsManager = SettingsManager.inMemory(
    {
      retry: { enabled: false },
      enableAnalytics: false,
      compaction: { enabled: true },
    },
    { projectTrusted: true },
  )
  const resourceLoader = new DefaultResourceLoader({
    cwd: config.projectRoot,
    agentDir: config.agentDirectory,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    systemPrompt:
      'You are Pictor, a delegate coding agent. Work only through the provided Pictor tools. Keep changes scoped to the selected project, explain progress briefly, and finish with results, changed files, verification, and remaining work.',
  })
  await resourceLoader.reload()

  const modelRuntime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false })
  const api =
    config.settings.apiProtocol === 'responses' ? 'openai-responses' : 'openai-completions'
  const reasoningEnabled = config.settings.reasoningEffort !== null
  modelRuntime.registerProvider(PROVIDER_ID, {
    name: 'Pictor OpenAI-compatible endpoint',
    api,
    baseUrl: config.settings.baseUrl,
    apiKey: config.apiKey,
    authHeader: true,
    models: [
      {
        id: config.settings.modelId,
        name: config.settings.modelId,
        api,
        reasoning: reasoningEnabled,
        ...(reasoningEnabled ? { thinkingLevelMap: { xhigh: 'xhigh', max: 'max' } } : {}),
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: config.settings.maxOutputTokens ?? 8192,
        ...(api === 'openai-completions' && reasoningEnabled
          ? { compat: { supportsReasoningEffort: true } }
          : {}),
        ...(config.settings.temperature === null
          ? {}
          : { samplingParams: { temperature: config.settings.temperature } }),
      },
    ],
  })
  const model = modelRuntime.getModel(PROVIDER_ID, config.settings.modelId)
  if (!model) throw new Error(`Model is unavailable: ${config.settings.modelId}`)

  const { session } = await createAgentSession({
    cwd: config.projectRoot,
    agentDir: config.agentDirectory,
    modelRuntime,
    model,
    thinkingLevel: config.settings.reasoningEffort ?? 'off',
    tools: tools.map((tool) => tool.name),
    customTools: tools,
    resourceLoader,
    settingsManager,
    sessionManager: SessionManager.continueRecent(config.projectRoot, config.sessionDirectory),
  })
  return session
}

export class PiAgentRuntime {
  private current: ActiveRuntime | undefined

  constructor(
    private readonly emit: (event: RuntimeEvent) => void,
    private readonly sessionFactory: SessionFactory = createProductionSession,
    private readonly commandExecutor: CommandExecutor = new GitBashCommandExecutor(),
  ) {}

  async start(config: RuntimeStartConfig): Promise<void> {
    if (this.current) throw new Error('Only one runtime run can be active')
    const abortController = new AbortController()
    const approvals = new ApprovalBroker((request) => {
      this.emitEvent(config, {
        type: 'approval.requested',
        callId: request.callId,
        command: request.command,
        cwd: request.cwd,
        purpose: request.purpose,
      })
    })
    const current: ActiveRuntime = {
      config,
      approvals,
      abortController,
      session: null,
      unsubscribe: null,
      cancelled: false,
      text: '',
      failure: null,
    }
    this.current = current
    this.emitEvent(config, { type: 'run.stateChanged', status: 'running', error: null })
    this.emitEvent(config, { type: 'message.started', messageId: config.messageId })

    try {
      const guard = await ProjectPathGuard.create(config.projectRoot)
      const tools = createPictorTools({
        guard,
        approvals,
        commandExecutor: this.commandExecutor,
        isCancelled: () => current.cancelled,
        onApprovalResolved: (request, allowed) => {
          this.emitEvent(config, {
            type: 'approval.resolved',
            callId: request.callId,
            allowed,
          })
        },
      })
      const session = await this.sessionFactory({ config, tools })
      current.session = session
      if (current.cancelled) {
        await session.abort()
        return
      }
      current.unsubscribe = session.subscribe((event) => this.handlePiEvent(current, event))
      await session.prompt(config.prompt, { expandPromptTemplates: false })
      await session.waitForIdle()

      if (current.cancelled) {
        this.emitEvent(config, { type: 'run.stateChanged', status: 'stopped', error: null })
      } else if (current.failure) {
        this.emitEvent(config, {
          type: 'run.stateChanged',
          status: 'failed',
          error: current.failure.message,
        })
      } else {
        this.emitEvent(config, {
          type: 'message.completed',
          messageId: config.messageId,
          content: current.text,
        })
        this.emitEvent(config, { type: 'run.stateChanged', status: 'completed', error: null })
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Pi runtime failed'
      if (current.cancelled) {
        this.emitEvent(config, { type: 'run.stateChanged', status: 'stopped', error: null })
      } else {
        const failure = runtimeFailure(detail)
        this.emitEvent(config, {
          type: 'runtime.error',
          ...failure,
        })
        this.emitEvent(config, {
          type: 'run.stateChanged',
          status: 'failed',
          error: failure.message,
        })
      }
    } finally {
      current.approvals.cancelAll()
      current.unsubscribe?.()
      current.session?.dispose()
      if (this.current === current) this.current = undefined
    }
  }

  resolveApproval(runId: string, callId: string, allowed: boolean): boolean {
    if (this.current?.config.runId !== runId) return false
    return this.current.approvals.resolve(callId, allowed)
  }

  async abort(runId: string): Promise<boolean> {
    const current = this.current
    if (!current || current.config.runId !== runId) return false
    current.cancelled = true
    current.abortController.abort(new Error('Run stopped'))
    current.approvals.cancelAll()
    this.emitEvent(current.config, { type: 'run.stateChanged', status: 'stopping', error: null })
    await current.session?.abort()
    return true
  }

  async dispose(): Promise<void> {
    if (this.current) await this.abort(this.current.config.runId)
  }

  private handlePiEvent(current: ActiveRuntime, event: AgentSessionEvent): void {
    const { config } = current
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
      current.text += event.assistantMessageEvent.delta
      this.emitEvent(config, {
        type: 'message.delta',
        messageId: config.messageId,
        delta: event.assistantMessageEvent.delta,
      })
      return
    }
    if (event.type === 'tool_execution_start') {
      const kind = toolKinds[event.toolName as keyof typeof toolKinds]
      if (!kind) return
      const path = toolPath(config.projectRoot, event.args)
      this.emitEvent(config, {
        type: 'tool.started',
        callId: event.toolCallId,
        kind,
        label: path ?? event.toolName,
        path,
      })
      return
    }
    if (event.type === 'tool_execution_update') {
      this.emitEvent(config, {
        type: 'tool.updated',
        callId: event.toolCallId,
        output: outputText(event.partialResult),
      })
      return
    }
    if (event.type === 'tool_execution_end') {
      this.emitEvent(config, {
        type: 'tool.completed',
        callId: event.toolCallId,
        output: outputText(event.result),
        isError: event.isError,
      })
      return
    }
    if (event.type === 'message_end' && 'errorMessage' in event.message) {
      const detail = Reflect.get(event.message, 'errorMessage')
      if (typeof detail === 'string' && detail && !current.failure) {
        const failure = runtimeFailure(detail)
        current.failure = failure
        this.emitEvent(config, {
          type: 'runtime.error',
          ...failure,
        })
      }
    }
  }

  private emitEvent(config: RuntimeStartConfig, event: RuntimeEventPayload): void {
    this.emit(
      runtimeEventSchema.parse({
        ...event,
        runId: config.runId,
        sessionId: config.sessionId,
        at: new Date().toISOString(),
      }),
    )
  }
}
