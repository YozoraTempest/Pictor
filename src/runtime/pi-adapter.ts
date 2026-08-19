import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSessionRuntime,
  type AgentSessionEvent,
  type ExtensionUIContext,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'

import {
  runtimeEventSchema,
  type RuntimeEvent,
  type RuntimeStartConfig,
} from '../shared/runtime-protocol.js'
import { createSecretRedactor, type SecretRedactor } from '../shared/secret-redaction.js'
import type { AgentRuntimeResources, ModelRuntimeProvider } from './plugin-interface.js'
import { ApprovalBroker } from './approval-broker.js'
import { BashCommandExecutor, type CommandExecutor } from './command-executor.js'
import { ExtensionUiBroker } from './extension-ui.js'
import { ProjectPathGuard } from './path-guard.js'
import { createPictorTools } from './tools.js'

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
  dispose(): void | Promise<void>
  bindExtensionUi?(context: ExtensionUIContext): Promise<void>
}

interface SessionFactoryInput {
  config: RuntimeStartConfig
  tools: ToolDefinition[]
  extensionPaths: readonly string[]
  modelProvider: ModelRuntimeProvider
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
  redactor: SecretRedactor
  extensionUi: ExtensionUiBroker
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
  extensionPaths,
  modelProvider,
}: SessionFactoryInput): Promise<PiSessionLike> {
  await mkdir(config.agentDirectory, { recursive: true })
  await mkdir(config.sessionDirectory, { recursive: true })
  const sessionManager = config.resumeSession
    ? SessionManager.continueRecent(config.projectRoot, config.sessionDirectory)
    : SessionManager.create(config.projectRoot, config.sessionDirectory)
  const createRuntime = async ({
    cwd,
    agentDir,
    sessionManager: targetSessionManager,
    sessionStartEvent,
  }: Parameters<Parameters<typeof createAgentSessionRuntime>[0]>[0]) => {
    const settingsManager = SettingsManager.inMemory(
      {
        retry: { enabled: false },
        enableAnalytics: false,
        compaction: { enabled: true },
      },
      { projectTrusted: true },
    )
    const modelRuntime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false })
    const model = modelProvider.register(modelRuntime, config.settings, config.apiKey)
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      settingsManager,
      modelRuntime,
      resourceLoaderOptions: {
        noExtensions: extensionPaths.length === 0,
        ...(extensionPaths.length > 0 ? { additionalExtensionPaths: [...extensionPaths] } : {}),
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        systemPrompt:
          'You are Pictor, a delegate coding agent. Work only through the provided Pictor tools. Keep changes scoped to the selected project, explain progress briefly, and finish with results, changed files, verification, and remaining work.',
      },
    })
    const result = await createAgentSessionFromServices({
      services,
      sessionManager: targetSessionManager,
      ...(sessionStartEvent ? { sessionStartEvent } : {}),
      model,
      thinkingLevel: config.settings.reasoningEffort ?? 'off',
      noTools: 'builtin',
      customTools: tools,
    })
    return { ...result, services, diagnostics: services.diagnostics }
  }
  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd: config.projectRoot,
    agentDir: config.agentDirectory,
    sessionManager,
  })
  return new PiSessionRuntime(runtime)
}

class PiSessionRuntime implements PiSessionLike {
  constructor(private readonly runtime: AgentSessionRuntime) {}

  subscribe(listener: (event: AgentSessionEvent) => void): () => void {
    return this.runtime.session.subscribe(listener)
  }

  prompt(text: string, options?: { expandPromptTemplates?: boolean }): Promise<void> {
    return this.runtime.session.prompt(text, options)
  }

  abort(): Promise<void> {
    return this.runtime.session.abort()
  }

  waitForIdle(): Promise<void> {
    return this.runtime.session.waitForIdle()
  }

  dispose(): Promise<void> {
    return this.runtime.dispose()
  }

  bindExtensionUi(context: ExtensionUIContext): Promise<void> {
    return this.runtime.session.bindExtensions({ uiContext: context, mode: 'rpc' })
  }
}

async function sanitizePiTranscripts(
  sessionDirectory: string,
  redactor: SecretRedactor,
): Promise<void> {
  let files: string[]
  try {
    files = await readdir(sessionDirectory)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
    throw error
  }
  for (const file of files) {
    if (!file.endsWith('.jsonl')) continue
    const path = resolve(sessionDirectory, file)
    const content = await readFile(path, 'utf8')
    const entries = content
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => redactor.redactPiEntry(JSON.parse(line)))
    const temporaryPath = `${path}.redacting`
    await writeFile(temporaryPath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`)
    await rename(temporaryPath, path)
  }
}

export class PiAgentRuntime {
  readonly id = 'pictor.pi-agent-runtime'
  private current: ActiveRuntime | undefined
  private extensionPaths: readonly string[] = []
  private modelProviders: readonly ModelRuntimeProvider[] = []

  constructor(
    private readonly emit: (event: RuntimeEvent) => void,
    private readonly sessionFactory: SessionFactory = createProductionSession,
    private readonly commandExecutor?: CommandExecutor,
  ) {}

  configure(resources: AgentRuntimeResources): void {
    this.extensionPaths = [...resources.extensionPaths]
    this.modelProviders = [...resources.modelProviders]
  }

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
      redactor: createSecretRedactor([config.apiKey]),
      extensionUi: new ExtensionUiBroker((event) => this.emitEvent(config, event)),
    }
    this.current = current

    try {
      this.emitEvent(config, { type: 'run.stateChanged', status: 'running', error: null })
      this.emitEvent(config, { type: 'message.started', messageId: config.messageId })
      const guard = await ProjectPathGuard.create(config.projectRoot)
      const commandExecutor =
        this.commandExecutor ?? new BashCommandExecutor(config.commandInterpreterPath ?? null)
      const tools = createPictorTools({
        guard,
        approvals,
        commandExecutor,
        isCancelled: () => current.cancelled,
        onApprovalResolved: (request, allowed) => {
          this.emitEvent(config, {
            type: 'approval.resolved',
            callId: request.callId,
            allowed,
          })
        },
      })
      const session = await this.sessionFactory({
        config,
        tools,
        extensionPaths: this.extensionPaths,
        modelProvider: this.getModelProvider(),
      })
      current.session = session
      if (current.cancelled) {
        await session.abort()
        return
      }
      current.unsubscribe = session.subscribe((event) => this.handlePiEvent(current, event))
      await session.bindExtensionUi?.(current.extensionUi.createContext())
      await session.prompt(current.redactor.redactText(config.prompt), {
        expandPromptTemplates: false,
      })
      await session.waitForIdle()
      await sanitizePiTranscripts(config.sessionDirectory, current.redactor)

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
      current.extensionUi.cancelAll()
      current.unsubscribe?.()
      await current.session?.dispose()
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
    current.extensionUi.cancelAll()
    this.emitEvent(current.config, { type: 'run.stateChanged', status: 'stopping', error: null })
    await current.session?.abort()
    return true
  }

  async dispose(): Promise<void> {
    if (this.current) await this.abort(this.current.config.runId)
  }

  respondToExtensionUi(requestId: string, value: string | boolean | null): void {
    this.current?.extensionUi.respond(requestId, value)
  }

  private getModelProvider(): ModelRuntimeProvider {
    if (this.modelProviders.length === 0) throw new Error('No Model Runtime Provider is active')
    if (this.modelProviders.length > 1)
      throw new Error('Multiple Model Runtime Providers are active')
    return this.modelProviders[0]!
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
      const kind = toolKinds[event.toolName as keyof typeof toolKinds] ?? 'custom'
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
    const redactor =
      this.current?.config === config
        ? this.current.redactor
        : createSecretRedactor([config.apiKey])
    const completeEvent = runtimeEventSchema.parse({
      ...event,
      runId: config.runId,
      sessionId: config.sessionId,
      at: new Date().toISOString(),
    })
    this.emit(redactor.redactRuntimeEvent(completeEvent))
  }
}
