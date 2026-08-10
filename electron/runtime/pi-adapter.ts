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
}

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

function classifyError(
  message: string,
): Extract<RuntimeEvent, { type: 'runtime.error' }>['category'] {
  const normalized = message.toLocaleLowerCase('en-US')
  if (normalized.includes('401') || normalized.includes('403') || normalized.includes('api key')) {
    return 'authentication'
  }
  if (normalized.includes('404') || normalized.includes('model')) return 'model'
  if (
    normalized.includes('network') ||
    normalized.includes('fetch') ||
    normalized.includes('connect') ||
    normalized.includes('timeout')
  ) {
    return 'connectivity'
  }
  if (normalized.includes('429') || /\b5\d\d\b/.test(normalized)) return 'server'
  return 'runtime'
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
  modelRuntime.registerProvider(PROVIDER_ID, {
    name: 'Pictor OpenAI-compatible endpoint',
    api: 'openai-completions',
    baseUrl: config.settings.baseUrl,
    apiKey: config.apiKey,
    authHeader: true,
    models: [
      {
        id: config.settings.modelId,
        name: config.settings.modelId,
        api: 'openai-completions',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: config.settings.maxOutputTokens ?? 8192,
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
    thinkingLevel: 'off',
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
      } else {
        this.emitEvent(config, {
          type: 'message.completed',
          messageId: config.messageId,
          content: current.text,
        })
        this.emitEvent(config, { type: 'run.stateChanged', status: 'completed', error: null })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Pi runtime failed'
      if (current.cancelled) {
        this.emitEvent(config, { type: 'run.stateChanged', status: 'stopped', error: null })
      } else {
        this.emitEvent(config, {
          type: 'runtime.error',
          category: classifyError(message),
          message,
        })
        this.emitEvent(config, { type: 'run.stateChanged', status: 'failed', error: message })
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
      const message = Reflect.get(event.message, 'errorMessage')
      if (typeof message === 'string' && message) {
        this.emitEvent(config, {
          type: 'runtime.error',
          category: classifyError(message),
          message,
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
