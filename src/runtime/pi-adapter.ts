import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve } from 'node:path'

import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSessionRuntime,
  type AgentSessionEvent,
  type CompactionResult,
  type ExtensionUIContext,
  type SessionStats,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'

import {
  runtimeEventSchema,
  type RuntimeEvent,
  type RuntimeCompactConfig,
  type RuntimeExportConfig,
  type RuntimeForkConfig,
  type RuntimeImportConfig,
  type RuntimeNavigateConfig,
  type RuntimeStartConfig,
} from '../shared/runtime-protocol.js'
import { classifyRuntimeFailure, type RuntimeFailure } from '../shared/runtime-failure.js'
import { createSecretRedactor, type SecretRedactor } from '../shared/secret-redaction.js'
import type {
  AgentRuntimeForkResult,
  AgentRuntimeCompactResult,
  AgentRuntimeExportResult,
  AgentRuntimeImportResult,
  AgentRuntimeNavigateResult,
  AgentRuntimeResources,
  ModelRuntimeProvider,
} from './plugin-interface.js'
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
  prompt(
    text: string,
    options?: {
      expandPromptTemplates?: boolean
      images?: Array<{ type: 'image'; data: string; mimeType: string }>
    },
  ): Promise<void>
  abort(): Promise<void>
  waitForIdle(): Promise<void>
  steer(text: string): Promise<void>
  followUp(text: string): Promise<void>
  clearQueue(): { steering: string[]; followUp: string[] }
  fork(entryId: string): Promise<{ cancelled: boolean }>
  importFromJsonl(inputPath: string, cwdOverride: string): Promise<{ cancelled: boolean }>
  navigateTree(
    entryId: string,
    options: { summarize: boolean; customInstructions?: string },
  ): Promise<{ cancelled: boolean; editorText?: string; summaryEntry?: unknown }>
  compact(customInstructions?: string): Promise<CompactionResult>
  abortCompaction(): void
  abortBranchSummary(): void
  exportToHtml(outputPath: string): Promise<string>
  exportToJsonl(outputPath: string): string
  getSessionStats(): SessionStats
  getSessionId(): string
  getSessionFile(): string | undefined
  getActiveLeafId(): string | null
  getDiagnostics?(): ReadonlyArray<{ type: 'info' | 'warning' | 'error'; message: string }>
  dispose(): void | Promise<void>
  bindExtensionUi?(context: ExtensionUIContext): Promise<void>
}

interface SessionFactoryInput {
  config: RuntimeStartConfig
  sessionFile?: string
  tools: ToolDefinition[]
  extensionPaths: readonly string[]
  skillPaths: readonly string[]
  promptPaths: readonly string[]
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
  sessionFile,
  tools,
  extensionPaths,
  skillPaths,
  promptPaths,
  modelProvider,
}: SessionFactoryInput): Promise<PiSessionLike> {
  await mkdir(config.agentDirectory, { recursive: true })
  await mkdir(config.sessionDirectory, { recursive: true })
  const sessionManager = sessionFile
    ? SessionManager.open(
        resolve(config.sessionDirectory, sessionFile),
        config.sessionDirectory,
        config.projectRoot,
      )
    : config.resumeSession
      ? SessionManager.continueRecent(config.projectRoot, config.sessionDirectory)
      : SessionManager.create(config.projectRoot, config.sessionDirectory)
  if (config.activeLeafId) sessionManager.branch(config.activeLeafId)
  else if (config.activeLeafId === null && 'activeLeafId' in config) sessionManager.resetLeaf()
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
        steeringMode: config.runtimePreferences?.steeringMode ?? 'one-at-a-time',
        followUpMode: config.runtimePreferences?.followUpMode ?? 'one-at-a-time',
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
        extensionsOverride: (base) => ({
          ...base,
          extensions: base.extensions.filter((extension) =>
            extensionPaths.some((allowedPath) => isPathWithin(allowedPath, extension.resolvedPath)),
          ),
          errors: base.errors.filter((error) =>
            extensionPaths.some((allowedPath) => isPathWithin(allowedPath, error.path)),
          ),
        }),
        ...(skillPaths.length > 0 ? { additionalSkillPaths: [...skillPaths] } : {}),
        noSkills: skillPaths.length === 0,
        ...(promptPaths.length > 0 ? { additionalPromptTemplatePaths: [...promptPaths] } : {}),
        noPromptTemplates: promptPaths.length === 0,
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
      thinkingLevel:
        config.runtimePreferences?.thinkingLevel ?? config.settings.reasoningEffort ?? 'off',
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
  if (config.sessionName && runtime.session.sessionName !== config.sessionName) {
    runtime.session.setSessionName(config.sessionName)
  }
  if (config.runtimePreferences?.activeTools) {
    runtime.session.setActiveToolsByName(config.runtimePreferences.activeTools)
  }
  return new PiSessionRuntime(runtime)
}

function isPathWithin(rootPath: string, candidatePath: string): boolean {
  const root = resolve(rootPath)
  const candidate = resolve(candidatePath)
  const relativePath = relative(root, candidate)
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

class PiSessionRuntime implements PiSessionLike {
  constructor(private readonly runtime: AgentSessionRuntime) {}

  subscribe(listener: (event: AgentSessionEvent) => void): () => void {
    return this.runtime.session.subscribe(listener)
  }

  prompt(
    text: string,
    options?: {
      expandPromptTemplates?: boolean
      images?: Array<{ type: 'image'; data: string; mimeType: string }>
    },
  ): Promise<void> {
    return this.runtime.session.prompt(text, options)
  }

  abort(): Promise<void> {
    return this.runtime.session.abort()
  }

  waitForIdle(): Promise<void> {
    return this.runtime.session.waitForIdle()
  }

  steer(text: string): Promise<void> {
    return this.runtime.session.steer(text)
  }

  followUp(text: string): Promise<void> {
    return this.runtime.session.followUp(text)
  }

  clearQueue(): { steering: string[]; followUp: string[] } {
    return this.runtime.session.clearQueue()
  }

  async fork(entryId: string): Promise<{ cancelled: boolean }> {
    const result = await this.runtime.fork(entryId, { position: 'at' })
    return { cancelled: result.cancelled }
  }

  async importFromJsonl(inputPath: string, cwdOverride: string): Promise<{ cancelled: boolean }> {
    return this.runtime.importFromJsonl(inputPath, cwdOverride)
  }

  navigateTree(
    entryId: string,
    options: { summarize: boolean; customInstructions?: string },
  ): Promise<{ cancelled: boolean; editorText?: string; summaryEntry?: unknown }> {
    return this.runtime.session.navigateTree(entryId, options)
  }

  compact(customInstructions?: string): Promise<CompactionResult> {
    return this.runtime.session.compact(customInstructions)
  }

  abortCompaction(): void {
    this.runtime.session.abortCompaction()
  }

  abortBranchSummary(): void {
    this.runtime.session.abortBranchSummary()
  }

  exportToHtml(outputPath: string): Promise<string> {
    return this.runtime.session.exportToHtml(outputPath)
  }

  exportToJsonl(outputPath: string): string {
    return this.runtime.session.exportToJsonl(outputPath)
  }

  getSessionStats(): SessionStats {
    return this.runtime.session.getSessionStats()
  }

  getSessionId(): string {
    return this.runtime.session.sessionId
  }

  getSessionFile(): string | undefined {
    return this.runtime.session.sessionFile
  }

  getActiveLeafId(): string | null {
    return this.runtime.session.sessionManager.getLeafId()
  }

  getDiagnostics(): ReadonlyArray<{
    type: 'info' | 'warning' | 'error'
    message: string
  }> {
    return this.runtime.diagnostics
  }

  dispose(): Promise<void> {
    return this.runtime.dispose()
  }

  bindExtensionUi(context: ExtensionUIContext): Promise<void> {
    const bind = () => this.runtime.session.bindExtensions({ uiContext: context, mode: 'rpc' })
    this.runtime.setRebindSession(bind)
    return bind()
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
    await sanitizePiTranscript(resolve(sessionDirectory, file), redactor)
  }
}

async function sanitizePiTranscript(path: string, redactor: SecretRedactor): Promise<void> {
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

export class PiAgentRuntime {
  readonly id = 'pictor.pi-agent-runtime'
  private current: ActiveRuntime | undefined
  private extensionPaths: readonly string[] = []
  private skillPaths: readonly string[] = []
  private promptPaths: readonly string[] = []
  private modelProviders: readonly ModelRuntimeProvider[] = []
  private sessionOperation: {
    operationId: string
    kind: 'fork' | 'import' | 'export' | 'navigate' | 'compact'
    broker: ExtensionUiBroker
    session: PiSessionLike | null
    cancelRequested: boolean
  } | null = null

  constructor(
    private readonly emit: (event: RuntimeEvent) => void,
    private readonly sessionFactory: SessionFactory = createProductionSession,
    private readonly commandExecutor?: CommandExecutor,
  ) {}

  configure(resources: AgentRuntimeResources): void {
    this.extensionPaths = [...resources.extensionPaths]
    this.skillPaths = [...resources.skillPaths]
    this.promptPaths = [...resources.promptPaths]
    this.modelProviders = [...resources.modelProviders]
  }

  async start(config: RuntimeStartConfig): Promise<void> {
    if (this.current || this.sessionOperation)
      throw new Error('Only one Runtime operation can be active')
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
        ...(config.piSessionFile ? { sessionFile: config.piSessionFile } : {}),
        tools,
        extensionPaths: this.extensionPaths,
        skillPaths: this.skillPaths,
        promptPaths: this.promptPaths,
        modelProvider: this.getModelProvider(),
      })
      current.session = session
      this.emitDiagnostics(config, session)
      const piSessionFile = session.getSessionFile()
      if (!piSessionFile) throw new Error('Pi Session did not provide a persistent JSONL file')
      this.emitEvent(config, {
        type: 'session.bound',
        piSessionId: session.getSessionId(),
        piSessionFile: basename(piSessionFile),
      })
      if (current.cancelled) {
        await session.abort()
        return
      }
      current.unsubscribe = session.subscribe((event) => this.handlePiEvent(current, event))
      await session.bindExtensionUi?.(current.extensionUi.createContext())
      await session.prompt(current.redactor.redactText(config.prompt), {
        expandPromptTemplates: true,
        ...(config.images && config.images.length > 0
          ? {
              images: config.images.map(({ data, mimeType }) => ({
                type: 'image' as const,
                data,
                mimeType,
              })),
            }
          : {}),
      })
      await session.waitForIdle()
      await sanitizePiTranscripts(config.sessionDirectory, current.redactor)
      const stats = session.getSessionStats()
      this.emitEvent(config, {
        type: 'usage.updated',
        tokens: stats.tokens,
        cost: stats.cost,
        context: stats.contextUsage ?? null,
      })
      this.emitEvent(config, {
        type: 'session.activeLeafChanged',
        activeLeafId: session.getActiveLeafId(),
      })

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
      if (current.session) {
        this.emitEvent(config, {
          type: 'session.activeLeafChanged',
          activeLeafId: current.session.getActiveLeafId(),
        })
      }
      if (current.cancelled) {
        this.emitEvent(config, { type: 'run.stateChanged', status: 'stopped', error: null })
      } else {
        const failure = classifyRuntimeFailure(detail)
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

  async fork(config: RuntimeForkConfig): Promise<AgentRuntimeForkResult> {
    if (this.current || this.sessionOperation)
      throw new Error('Only one Runtime operation can be active')
    if (config.sourcePiSessionFile !== basename(config.sourcePiSessionFile)) {
      throw new Error('Source Pi Session file must be a basename')
    }
    const redactor = createSecretRedactor([config.apiKey])
    const eventConfig: RuntimeStartConfig = {
      type: 'start',
      runId: config.operationId,
      sessionId: config.sourceSessionId,
      messageId: config.operationId,
      projectRoot: config.projectRoot,
      agentDirectory: config.agentDirectory,
      sessionDirectory: config.sourceSessionDirectory,
      resumeSession: true,
      settings: config.settings,
      apiKey: config.apiKey,
      prompt: 'Fork Pi Session',
    }
    const broker = new ExtensionUiBroker((event) => this.emitEvent(eventConfig, event))
    this.sessionOperation = {
      operationId: config.operationId,
      kind: 'fork',
      broker,
      session: null,
      cancelRequested: false,
    }
    let session: PiSessionLike | null = null
    let disposed = false

    try {
      session = await this.sessionFactory({
        config: eventConfig,
        sessionFile: config.sourcePiSessionFile,
        tools: [],
        extensionPaths: this.extensionPaths,
        skillPaths: this.skillPaths,
        promptPaths: this.promptPaths,
        modelProvider: this.getModelProvider(),
      })
      if (this.sessionOperation?.operationId === config.operationId) {
        this.sessionOperation.session = session
      }
      await session.bindExtensionUi?.(broker.createContext())
      const result = await session.fork(config.entryId)
      if (result.cancelled) return { outcome: 'cancelled' }

      const piSessionFile = session.getSessionFile()
      if (!piSessionFile) throw new Error('Forked Pi Session did not provide a JSONL file')
      const piSessionFileName = basename(piSessionFile)
      if (piSessionFileName === config.sourcePiSessionFile) {
        throw new Error('Pi Fork did not create an independent Session file')
      }
      const piSessionId = session.getSessionId()
      await sanitizePiTranscript(
        resolve(config.sourceSessionDirectory, piSessionFileName),
        redactor,
      )
      await session.dispose()
      disposed = true
      await mkdir(config.targetSessionDirectory, { recursive: true })
      await rename(
        resolve(config.sourceSessionDirectory, piSessionFileName),
        resolve(config.targetSessionDirectory, piSessionFileName),
      )
      return { outcome: 'completed', piSessionId, piSessionFile: piSessionFileName }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Pi Session Fork failed'
      throw new Error(redactor.redactText(detail), { cause: error })
    } finally {
      broker.cancelAll()
      if (!disposed && session) await Promise.resolve(session.dispose()).catch(() => undefined)
      if (this.sessionOperation?.operationId === config.operationId) {
        this.sessionOperation = null
      }
    }
  }

  async importSession(config: RuntimeImportConfig): Promise<AgentRuntimeImportResult> {
    if (this.current || this.sessionOperation)
      throw new Error('Only one Runtime operation can be active')
    if (!isAbsolute(config.sourceJsonlPath)) {
      throw new Error('Imported Pi Session path must be absolute')
    }
    const redactor = createSecretRedactor([config.apiKey])
    const eventConfig: RuntimeStartConfig = {
      type: 'start',
      runId: config.operationId,
      sessionId: config.targetSessionId,
      messageId: config.operationId,
      projectRoot: config.projectRoot,
      agentDirectory: config.agentDirectory,
      sessionDirectory: config.targetSessionDirectory,
      resumeSession: false,
      settings: config.settings,
      apiKey: config.apiKey,
      prompt: 'Import Pi Session',
    }
    const broker = new ExtensionUiBroker((event) => this.emitEvent(eventConfig, event))
    this.sessionOperation = {
      operationId: config.operationId,
      kind: 'import',
      broker,
      session: null,
      cancelRequested: false,
    }
    let session: PiSessionLike | null = null
    let disposed = false
    let completed = false

    try {
      session = await this.sessionFactory({
        config: eventConfig,
        tools: [],
        extensionPaths: this.extensionPaths,
        skillPaths: this.skillPaths,
        promptPaths: this.promptPaths,
        modelProvider: this.getModelProvider(),
      })
      if (this.sessionOperation?.operationId === config.operationId) {
        this.sessionOperation.session = session
      }
      await session.bindExtensionUi?.(broker.createContext())
      const initialSessionFile = session.getSessionFile()
      const result = await session.importFromJsonl(config.sourceJsonlPath, config.projectRoot)
      if (result.cancelled) return { outcome: 'cancelled' }

      const importedSessionFile = session.getSessionFile()
      if (!importedSessionFile) throw new Error('Imported Pi Session did not provide a JSONL file')
      if (!isPathWithin(config.targetSessionDirectory, importedSessionFile)) {
        throw new Error('Pi Import did not create a Session copy in the target directory')
      }
      if (resolve(importedSessionFile) === resolve(config.sourceJsonlPath)) {
        throw new Error('Pi Import did not create an independent Session copy')
      }
      const piSessionFile = basename(importedSessionFile)
      const piSessionId = session.getSessionId()
      await sanitizePiTranscript(importedSessionFile, redactor)
      await session.dispose()
      disposed = true
      if (initialSessionFile && resolve(initialSessionFile) !== resolve(importedSessionFile)) {
        await unlink(initialSessionFile).catch(() => undefined)
      }
      completed = true
      return { outcome: 'completed', piSessionId, piSessionFile }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Pi Session Import failed'
      throw new Error(redactor.redactText(detail), { cause: error })
    } finally {
      broker.cancelAll()
      if (!disposed && session) await Promise.resolve(session.dispose()).catch(() => undefined)
      if (!completed) await rm(config.targetSessionDirectory, { recursive: true, force: true })
      if (this.sessionOperation?.operationId === config.operationId) {
        this.sessionOperation = null
      }
    }
  }

  async exportSession(config: RuntimeExportConfig): Promise<AgentRuntimeExportResult> {
    if (this.current || this.sessionOperation)
      throw new Error('Only one Runtime operation can be active')
    if (config.sourcePiSessionFile !== basename(config.sourcePiSessionFile)) {
      throw new Error('Source Pi Session file must be a basename')
    }
    if (!isAbsolute(config.destinationPath)) {
      throw new Error('Pi Session export destination must be absolute')
    }
    const sourcePath = resolve(config.sourceSessionDirectory, config.sourcePiSessionFile)
    if (resolve(config.destinationPath) === sourcePath) {
      throw new Error('Pi Session export cannot overwrite its source history')
    }
    const expectedExtension = config.format === 'jsonl' ? '.jsonl' : '.html'
    if (config.destinationPath.toLowerCase().endsWith(expectedExtension) === false) {
      throw new Error(
        `Pi Session ${config.format.toUpperCase()} export requires ${expectedExtension}`,
      )
    }

    const redactor = createSecretRedactor([config.apiKey])
    const temporarySessionDirectory = await mkdtemp(
      resolve(config.sourceSessionDirectory, '.pictor-export-'),
    )
    const eventConfig: RuntimeStartConfig = {
      type: 'start',
      runId: config.operationId,
      sessionId: config.sourceSessionId,
      messageId: config.operationId,
      projectRoot: config.projectRoot,
      agentDirectory: config.agentDirectory,
      sessionDirectory: temporarySessionDirectory,
      resumeSession: true,
      activeLeafId: config.activeLeafId,
      settings: config.settings,
      apiKey: config.apiKey,
      prompt: 'Export Pi Session',
    }
    const broker = new ExtensionUiBroker((event) => this.emitEvent(eventConfig, event))
    this.sessionOperation = {
      operationId: config.operationId,
      kind: 'export',
      broker,
      session: null,
      cancelRequested: false,
    }
    let session: PiSessionLike | null = null

    try {
      await copyFile(sourcePath, resolve(temporarySessionDirectory, config.sourcePiSessionFile))
      session = await this.sessionFactory({
        config: eventConfig,
        sessionFile: config.sourcePiSessionFile,
        tools: [],
        extensionPaths: [],
        skillPaths: [],
        promptPaths: [],
        modelProvider: this.getModelProvider(),
      })
      if (this.sessionOperation?.operationId === config.operationId) {
        this.sessionOperation.session = session
      }
      if (config.format === 'jsonl') session.exportToJsonl(config.destinationPath)
      else await session.exportToHtml(config.destinationPath)
      return { outcome: 'completed' }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Pi Session Export failed'
      throw new Error(redactor.redactText(detail), { cause: error })
    } finally {
      broker.cancelAll()
      if (session) await Promise.resolve(session.dispose()).catch(() => undefined)
      await rm(temporarySessionDirectory, { recursive: true, force: true })
      if (this.sessionOperation?.operationId === config.operationId) {
        this.sessionOperation = null
      }
    }
  }

  async navigateSession(config: RuntimeNavigateConfig): Promise<AgentRuntimeNavigateResult> {
    if (this.current || this.sessionOperation)
      throw new Error('Only one Runtime operation can be active')
    if (config.sourcePiSessionFile !== basename(config.sourcePiSessionFile)) {
      throw new Error('Source Pi Session file must be a basename')
    }
    const redactor = createSecretRedactor([config.apiKey])
    const eventConfig: RuntimeStartConfig = {
      type: 'start',
      runId: config.operationId,
      sessionId: config.sourceSessionId,
      messageId: config.operationId,
      projectRoot: config.projectRoot,
      agentDirectory: config.agentDirectory,
      sessionDirectory: config.sourceSessionDirectory,
      resumeSession: true,
      activeLeafId: config.activeLeafId,
      settings: config.settings,
      apiKey: config.apiKey,
      prompt: 'Navigate Pi Session Tree',
    }
    const broker = new ExtensionUiBroker((event) => this.emitEvent(eventConfig, event))
    this.sessionOperation = {
      operationId: config.operationId,
      kind: 'navigate',
      broker,
      session: null,
      cancelRequested: false,
    }
    let session: PiSessionLike | null = null

    try {
      session = await this.sessionFactory({
        config: eventConfig,
        sessionFile: config.sourcePiSessionFile,
        tools: [],
        extensionPaths: this.extensionPaths,
        skillPaths: this.skillPaths,
        promptPaths: this.promptPaths,
        modelProvider: this.getModelProvider(),
      })
      if (this.sessionOperation?.operationId === config.operationId) {
        this.sessionOperation.session = session
      }
      await session.bindExtensionUi?.(broker.createContext())
      const result = await session.navigateTree(config.entryId, {
        summarize: config.summarize,
        ...(config.customInstructions ? { customInstructions: config.customInstructions } : {}),
      })
      if (result.cancelled) return { outcome: 'cancelled' }
      await sanitizePiTranscript(
        resolve(config.sourceSessionDirectory, config.sourcePiSessionFile),
        redactor,
      )
      return {
        outcome: 'completed',
        activeLeafId: session.getActiveLeafId(),
        editorText: result.editorText ?? null,
        summaryCreated: result.summaryEntry !== undefined,
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Pi Session Tree Navigation failed'
      throw new Error(redactor.redactText(detail), { cause: error })
    } finally {
      broker.cancelAll()
      if (session) await Promise.resolve(session.dispose()).catch(() => undefined)
      if (this.sessionOperation?.operationId === config.operationId) {
        this.sessionOperation = null
      }
    }
  }

  async compactSession(config: RuntimeCompactConfig): Promise<AgentRuntimeCompactResult> {
    if (this.current || this.sessionOperation)
      throw new Error('Only one Runtime operation can be active')
    if (config.sourcePiSessionFile !== basename(config.sourcePiSessionFile)) {
      throw new Error('Source Pi Session file must be a basename')
    }
    const redactor = createSecretRedactor([config.apiKey])
    const eventConfig: RuntimeStartConfig = {
      type: 'start',
      runId: config.operationId,
      sessionId: config.sourceSessionId,
      messageId: config.operationId,
      projectRoot: config.projectRoot,
      agentDirectory: config.agentDirectory,
      sessionDirectory: config.sourceSessionDirectory,
      resumeSession: true,
      activeLeafId: config.activeLeafId,
      settings: config.settings,
      apiKey: config.apiKey,
      prompt: 'Compact Pi Session',
    }
    const broker = new ExtensionUiBroker((event) => this.emitEvent(eventConfig, event))
    this.sessionOperation = {
      operationId: config.operationId,
      kind: 'compact',
      broker,
      session: null,
      cancelRequested: false,
    }
    let session: PiSessionLike | null = null
    let unsubscribe: (() => void) | null = null

    try {
      session = await this.sessionFactory({
        config: eventConfig,
        sessionFile: config.sourcePiSessionFile,
        tools: [],
        extensionPaths: this.extensionPaths,
        skillPaths: this.skillPaths,
        promptPaths: this.promptPaths,
        modelProvider: this.getModelProvider(),
      })
      if (this.sessionOperation?.operationId === config.operationId) {
        this.sessionOperation.session = session
        if (this.sessionOperation.cancelRequested) return { outcome: 'cancelled' }
      }
      await session.bindExtensionUi?.(broker.createContext())
      unsubscribe = session.subscribe((event) => this.handleCompactionEvent(eventConfig, event))
      const result = await session.compact(config.customInstructions ?? undefined)
      const activeLeafId = session.getActiveLeafId()
      if (!activeLeafId) throw new Error('Pi Compaction did not provide an active leaf')
      await sanitizePiTranscript(
        resolve(config.sourceSessionDirectory, config.sourcePiSessionFile),
        redactor,
      )
      return {
        outcome: 'completed',
        activeLeafId,
        tokensBefore: result.tokensBefore,
        estimatedTokensAfter: result.estimatedTokensAfter ?? null,
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Pi Session Compaction failed'
      if (detail === 'Compaction cancelled' || detail.includes('aborted')) {
        return { outcome: 'cancelled' }
      }
      throw new Error(redactor.redactText(detail), { cause: error })
    } finally {
      unsubscribe?.()
      broker.cancelAll()
      if (session) await Promise.resolve(session.dispose()).catch(() => undefined)
      if (this.sessionOperation?.operationId === config.operationId) {
        this.sessionOperation = null
      }
    }
  }

  abortSessionOperation(operationId: string): void {
    const operation = this.sessionOperation
    if (!operation || operation.operationId !== operationId) return
    operation.cancelRequested = true
    operation.broker.cancelAll()
    if (operation.kind === 'compact') operation.session?.abortCompaction()
    if (operation.kind === 'navigate') operation.session?.abortBranchSummary()
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
    if (this.sessionOperation?.kind === 'compact') {
      this.sessionOperation.session?.abortCompaction()
    }
    if (this.sessionOperation?.kind === 'navigate') {
      this.sessionOperation.session?.abortBranchSummary()
    }
    this.sessionOperation?.broker.cancelAll()
  }

  async queueMessage(runId: string, mode: 'steer' | 'follow-up', message: string): Promise<void> {
    const current = this.current
    if (!current || current.config.runId !== runId || !current.session) {
      throw new Error('运行不存在或尚未准备好接收队列消息')
    }
    const sanitized = current.redactor.redactText(message)
    if (mode === 'steer') await current.session.steer(sanitized)
    else await current.session.followUp(sanitized)
  }

  clearQueue(runId: string): void {
    const current = this.current
    if (!current || current.config.runId !== runId || !current.session) return
    current.session.clearQueue()
  }

  respondToExtensionUi(requestId: string, value: string | boolean | null): void {
    if (this.current) this.current.extensionUi.respond(requestId, value)
    else this.sessionOperation?.broker.respond(requestId, value)
  }

  private getModelProvider(): ModelRuntimeProvider {
    if (this.modelProviders.length === 0) throw new Error('No Model Runtime Provider is active')
    if (this.modelProviders.length > 1)
      throw new Error('Multiple Model Runtime Providers are active')
    return this.modelProviders[0]!
  }

  private emitDiagnostics(config: RuntimeStartConfig, session: PiSessionLike): void {
    for (const diagnostic of session.getDiagnostics?.() ?? []) {
      this.emitEvent(config, {
        type: 'runtime.diagnostic',
        severity: diagnostic.type,
        message: diagnostic.message,
      })
    }
  }

  private handlePiEvent(current: ActiveRuntime, event: AgentSessionEvent): void {
    const { config } = current
    if (event.type === 'compaction_start' || event.type === 'compaction_end') {
      this.handleCompactionEvent(config, event)
      return
    }
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
      current.text += event.assistantMessageEvent.delta
      this.emitEvent(config, {
        type: 'message.delta',
        messageId: config.messageId,
        delta: event.assistantMessageEvent.delta,
      })
      return
    }
    if (event.type === 'queue_update') {
      this.emitEvent(config, {
        type: 'queue.updated',
        steering: [...event.steering],
        followUp: [...event.followUp],
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
        const failure = classifyRuntimeFailure(detail)
        current.failure = failure
        this.emitEvent(config, {
          type: 'runtime.error',
          ...failure,
        })
      }
    }
  }

  private handleCompactionEvent(config: RuntimeStartConfig, event: AgentSessionEvent): void {
    if (event.type === 'compaction_start') {
      this.emitEvent(config, {
        type: 'compaction.stateChanged',
        status: 'running',
        reason: event.reason,
        tokensBefore: null,
        estimatedTokensAfter: null,
        error: null,
      })
      return
    }
    if (event.type !== 'compaction_end') return
    this.emitEvent(config, {
      type: 'compaction.stateChanged',
      status: event.aborted ? 'cancelled' : event.errorMessage ? 'failed' : 'completed',
      reason: event.reason,
      tokensBefore: event.result?.tokensBefore ?? null,
      estimatedTokensAfter: event.result?.estimatedTokensAfter ?? null,
      error: event.errorMessage ?? null,
    })
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
