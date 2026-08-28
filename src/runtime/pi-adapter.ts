import { randomUUID } from 'node:crypto'

import { copyFile, mkdir, mkdtemp, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'

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
  type ExtensionCommandContextActions,
  type ExtensionError,
  type ExtensionUIContext,
  type SessionStats,
} from '@earendil-works/pi-coding-agent'

import {
  runtimeEventSchema,
  type RuntimeEvent,
  type RuntimeCompactConfig,
  type RuntimeExportConfig,
  type RuntimeForkConfig,
  type RuntimeImportConfig,
  type RuntimeLabelConfig,
  type RuntimeNavigateConfig,
  type RuntimeSessionConfig,
  type RuntimeSessionOpenConfig,
  type RuntimeSessionReplacementRequest,
  type RuntimeStartConfig,
} from '../shared/runtime-protocol.js'
import { classifyRuntimeFailure, type RuntimeFailure } from '../shared/runtime-failure.js'
import { createSecretRedactor, type SecretRedactor } from '../shared/secret-redaction.js'
import type {
  AgentRuntimeForkResult,
  AgentRuntimeCompactResult,
  AgentRuntimeExportResult,
  AgentRuntimeImportResult,
  AgentRuntimeLabelResult,
  AgentRuntimeNavigateResult,
  AgentRuntimeResources,
  ModelRuntimeProvider,
} from './plugin-interface.js'
import { ExtensionUiBroker } from './extension-ui.js'

type ReplacementContext =
  NonNullable<
    NonNullable<Parameters<ExtensionCommandContextActions['newSession']>[0]>['withSession']
  > extends (context: infer Context) => unknown
    ? Context
    : never

const toolKinds = {
  ls: 'list',
  grep: 'search',
  read: 'read',
  write: 'write',
  edit: 'edit',
  bash: 'command',
  find: 'list',
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
  fork(
    entryId: string,
    options?: {
      position?: 'before' | 'at'
      withSession?: (context: ReplacementContext) => Promise<void>
    },
  ): Promise<{ cancelled: boolean; selectedText?: string }>
  newSession?(options?: Parameters<ExtensionCommandContextActions['newSession']>[0]): Promise<{
    cancelled: boolean
  }>
  switchSession?(
    sessionPath: string,
    options?: Parameters<ExtensionCommandContextActions['switchSession']>[1],
  ): Promise<{ cancelled: boolean }>
  reload?(): Promise<void>
  importFromJsonl(inputPath: string, cwdOverride: string): Promise<{ cancelled: boolean }>
  navigateTree(
    entryId: string,
    options: { summarize: boolean; customInstructions?: string },
  ): Promise<{ cancelled: boolean; editorText?: string; summaryEntry?: unknown }>
  compact(customInstructions?: string): Promise<CompactionResult>
  abortCompaction(): void
  abortBranchSummary(): void
  labelEntry(entryId: string, label: string | undefined): void
  exportToHtml(outputPath: string): Promise<string>
  exportToJsonl(outputPath: string): string
  getSessionStats(): SessionStats
  getSessionId(): string
  getSessionFile(): string | undefined
  getActiveLeafId(): string | null
  getDiagnostics?(): ReadonlyArray<{ type: 'info' | 'warning' | 'error'; message: string }>
  dispose(): void | Promise<void>
  bindExtensionUi?(
    context: ExtensionUIContext,
    options?: {
      commandContextActions?: ExtensionCommandContextActions
      beforeRebind?: () => Promise<void>
      beforeSessionInvalidate?: () => void
      afterRebind?: () => Promise<void> | void
      onError?: (error: ExtensionError) => void
    },
  ): Promise<void>
  getActiveToolNames?(): string[]
  getAllTools?(): ReadonlyArray<{ name: string }>
  getModelId?(): string | null
  getThinkingLevel?(): 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  getSteeringMode?(): 'all' | 'one-at-a-time'
  getFollowUpMode?(): 'all' | 'one-at-a-time'
  getModelRuntime?(): ModelRuntime
  setModel?(model: Parameters<AgentSessionRuntime['session']['setModel']>[0]): Promise<void>
  setActiveToolNames?(names: string[]): void
  setThinkingLevel?(level: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'): void
  setSteeringMode?(mode: 'all' | 'one-at-a-time'): void
  setFollowUpMode?(mode: 'all' | 'one-at-a-time'): void
  getCwd?(): string
}

interface SessionFactoryInput {
  config: RuntimeSessionConfig
  sessionFile?: string
  extensionPaths: readonly string[]
  skillPaths: readonly string[]
  promptPaths: readonly string[]
  modelProvider: ModelRuntimeProvider
}

type SessionFactory = (input: SessionFactoryInput) => Promise<PiSessionLike>

interface ActiveRuntime {
  config: RuntimeStartConfig
  abortController: AbortController
  session: PiSessionLike | null
  cancelled: boolean
  text: string
  thinkingStarted: boolean
  textStarted: boolean
  failure: RuntimeFailure | null
  redactor: SecretRedactor
  extensionUi: ExtensionUiBroker
}

interface OpenRuntimeSession {
  sessionId: string
  config: RuntimeSessionConfig
  session: PiSessionLike
  extensionUi: ExtensionUiBroker
  unsubscribe: () => void
  redactor: SecretRedactor
  pendingReplacement:
    | {
        operationId: string
        kind: 'new' | 'fork' | 'switch'
        sourceSessionId: string
        targetSessionId: string
        commitRequested: boolean
      }
    | undefined
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

function configuredSessionPath(config: { sourcePiSessionPath: string | undefined }): string {
  if (!config.sourcePiSessionPath || !isAbsolute(config.sourcePiSessionPath)) {
    throw new Error('Pi Session operation requires an absolute source path')
  }
  return resolve(config.sourcePiSessionPath)
}

async function createProductionSession({
  config,
  sessionFile,
  extensionPaths,
  skillPaths,
  promptPaths,
  modelProvider,
}: SessionFactoryInput): Promise<PiSessionLike> {
  await mkdir(config.agentDirectory, { recursive: true })
  await mkdir(config.sessionDirectory, { recursive: true })
  const requestedSessionPath = sessionFile
    ? isAbsolute(sessionFile)
      ? resolve(sessionFile)
      : resolve(config.sessionDirectory, sessionFile)
    : config.piSessionPath
      ? resolve(config.piSessionPath)
      : null
  const sessionManager = requestedSessionPath
    ? SessionManager.open(requestedSessionPath, dirname(requestedSessionPath), config.projectRoot)
    : SessionManager.create(config.projectRoot, config.sessionDirectory)
  if (config.activeLeafId) sessionManager.branch(config.activeLeafId)
  else if (config.activeLeafId === null && 'activeLeafId' in config) sessionManager.resetLeaf()
  const createRuntime = async ({
    cwd,
    agentDir,
    sessionManager: targetSessionManager,
    sessionStartEvent,
  }: Parameters<Parameters<typeof createAgentSessionRuntime>[0]>[0]) => {
    const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: true })
    settingsManager.applyOverrides({
      ...(config.runtimePreferences?.steeringMode
        ? { steeringMode: config.runtimePreferences.steeringMode }
        : {}),
      ...(config.runtimePreferences?.followUpMode
        ? { followUpMode: config.runtimePreferences.followUpMode }
        : {}),
    })
    const modelRuntime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false })
    const model = modelProvider.register(
      modelRuntime,
      {
        ...config.settings,
        modelId: config.runtimePreferences?.modelId ?? config.settings.modelId,
      },
      config.apiKey,
    )
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      settingsManager,
      modelRuntime,
      resourceLoaderOptions: {
        additionalExtensionPaths: [...extensionPaths],
        additionalSkillPaths: [...skillPaths],
        additionalPromptTemplatePaths: [...promptPaths],
      },
    })
    const result = await createAgentSessionFromServices({
      services,
      sessionManager: targetSessionManager,
      ...(sessionStartEvent ? { sessionStartEvent } : {}),
      model,
      thinkingLevel:
        config.runtimePreferences?.thinkingLevel ?? config.settings.reasoningEffort ?? 'off',
    })
    const activeTools = config.runtimePreferences?.activeTools ?? [
      ...new Set([...result.session.getActiveToolNames(), ...Object.keys(toolKinds)]),
    ]
    result.session.setActiveToolsByName(activeTools)
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

  async fork(
    entryId: string,
    options?: {
      position?: 'before' | 'at'
      withSession?: (context: ReplacementContext) => Promise<void>
    },
  ): Promise<{ cancelled: boolean; selectedText?: string }> {
    return this.runtime.fork(entryId, options)
  }

  newSession(options?: Parameters<ExtensionCommandContextActions['newSession']>[0]) {
    return this.runtime.newSession(options)
  }

  switchSession(
    sessionPath: string,
    options?: Parameters<ExtensionCommandContextActions['switchSession']>[1],
  ) {
    return this.runtime.switchSession(sessionPath, options)
  }

  reload(): Promise<void> {
    return this.runtime.session.reload()
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

  labelEntry(entryId: string, label: string | undefined): void {
    this.runtime.session.sessionManager.appendLabelChange(entryId, label)
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

  getActiveToolNames(): string[] {
    return this.runtime.session.getActiveToolNames()
  }

  getAllTools(): ReadonlyArray<{ name: string }> {
    return this.runtime.session.getAllTools()
  }

  getModelId(): string | null {
    return this.runtime.session.model?.id ?? null
  }

  getThinkingLevel() {
    return this.runtime.session.thinkingLevel
  }

  getSteeringMode() {
    return this.runtime.session.steeringMode
  }

  getFollowUpMode() {
    return this.runtime.session.followUpMode
  }

  getModelRuntime(): ModelRuntime {
    return this.runtime.session.modelRuntime
  }

  setModel(model: Parameters<AgentSessionRuntime['session']['setModel']>[0]): Promise<void> {
    return this.runtime.session.setModel(model)
  }

  setActiveToolNames(names: string[]): void {
    this.runtime.session.setActiveToolsByName(names)
  }

  setThinkingLevel(level: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'): void {
    this.runtime.session.setThinkingLevel(level)
  }

  setSteeringMode(mode: 'all' | 'one-at-a-time'): void {
    this.runtime.session.setSteeringMode(mode)
  }

  setFollowUpMode(mode: 'all' | 'one-at-a-time'): void {
    this.runtime.session.setFollowUpMode(mode)
  }

  getCwd(): string {
    return this.runtime.cwd
  }

  bindExtensionUi(
    context: ExtensionUIContext,
    options?: {
      commandContextActions?: ExtensionCommandContextActions
      beforeRebind?: () => Promise<void>
      beforeSessionInvalidate?: () => void
      afterRebind?: () => Promise<void> | void
      onError?: (error: ExtensionError) => void
    },
  ): Promise<void> {
    const bind = async () => {
      await options?.beforeRebind?.()
      this.runtime.setBeforeSessionInvalidate(options?.beforeSessionInvalidate)
      await this.runtime.session.bindExtensions({
        uiContext: context,
        mode: 'rpc',
        ...(options?.commandContextActions
          ? { commandContextActions: options.commandContextActions }
          : {}),
        ...(options?.onError ? { onError: options.onError } : {}),
      })
      await options?.afterRebind?.()
    }
    this.runtime.setRebindSession(bind)
    return bind()
  }
}

async function sanitizePiTranscript(path: string, redactor: SecretRedactor): Promise<void> {
  let content: string
  try {
    content = await readFile(path, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
    throw error
  }
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
  private opened: OpenRuntimeSession | null = null
  private extensionPaths: readonly string[] = []
  private skillPaths: readonly string[] = []
  private promptPaths: readonly string[] = []
  private modelProviders: readonly ModelRuntimeProvider[] = []
  private sessionOperation: {
    operationId: string
    kind: 'fork' | 'import' | 'export' | 'navigate' | 'compact' | 'label'
    broker: ExtensionUiBroker
    session: PiSessionLike | null
    cancelRequested: boolean
  } | null = null
  private requestSessionReplacement:
    NonNullable<AgentRuntimeResources['requestSessionReplacement']> | undefined

  constructor(
    private readonly emit: (event: RuntimeEvent) => void,
    private readonly sessionFactory: SessionFactory = createProductionSession,
  ) {}

  configure(resources: AgentRuntimeResources): void {
    this.extensionPaths = [...resources.extensionPaths]
    this.skillPaths = [...resources.skillPaths]
    this.promptPaths = [...resources.promptPaths]
    this.modelProviders = [...resources.modelProviders]
    this.requestSessionReplacement = resources.requestSessionReplacement
  }

  async openSession(config: RuntimeSessionOpenConfig): Promise<void> {
    if (this.current || this.sessionOperation) {
      throw new Error('Only one Runtime operation can be active')
    }
    await this.ensureOpenSession(config)
  }

  async closeSession(): Promise<void> {
    if (this.current || this.sessionOperation) {
      throw new Error('Only one Runtime operation can be active')
    }
    if (this.opened) await this.closeOpenedSession(this.opened)
  }

  async start(config: RuntimeStartConfig): Promise<void> {
    if (this.current || this.sessionOperation)
      throw new Error('Only one Runtime operation can be active')
    const abortController = new AbortController()
    const current: ActiveRuntime = {
      config,
      abortController,
      session: null,
      cancelled: false,
      text: '',
      thinkingStarted: false,
      textStarted: false,
      failure: null,
      redactor: createSecretRedactor([config.apiKey]),
      extensionUi: new ExtensionUiBroker((event) => this.emitSessionPayload(this.opened, event)),
    }
    this.current = current

    try {
      this.emitEvent(config, { type: 'run.stateChanged', status: 'running', error: null })
      this.emitEvent(config, { type: 'message.started', messageId: config.messageId })
      const opened = await this.ensureOpenSession(config)
      current.session = opened.session
      current.extensionUi = opened.extensionUi
      if (current.cancelled) {
        await opened.session.abort()
        return
      }
      await opened.session.prompt(opened.redactor.redactText(config.prompt), {
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
      await opened.session.waitForIdle()
      const piSessionPath = opened.session.getSessionFile()
      if (piSessionPath) await sanitizePiTranscript(piSessionPath, current.redactor)
      const stats = opened.session.getSessionStats()
      this.emitSessionPayload(opened, {
        type: 'usage.updated',
        tokens: stats.tokens,
        cost: stats.cost,
        context: stats.contextUsage ?? null,
      })
      this.emitSessionPayload(opened, {
        type: 'session.activeLeafChanged',
        activeLeafId: opened.session.getActiveLeafId(),
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
        this.emitSessionPayload(this.opened, {
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
      current.extensionUi.cancelAll()
      if (this.current === current) this.current = undefined
    }
  }

  private async ensureOpenSession(config: RuntimeSessionConfig): Promise<OpenRuntimeSession> {
    const requestedPath = config.piSessionPath ? resolve(config.piSessionPath) : null
    const openedPath = this.opened?.session.getSessionFile()
    if (
      this.opened &&
      this.opened.sessionId === config.sessionId &&
      (!requestedPath || openedPath === requestedPath)
    ) {
      return this.opened
    }

    if (this.opened) await this.closeOpenedSession(this.opened)

    const session = await this.sessionFactory({
      config,
      ...(requestedPath ? { sessionFile: requestedPath } : {}),
      extensionPaths: this.extensionPaths,
      skillPaths: this.skillPaths,
      promptPaths: this.promptPaths,
      modelProvider: this.getModelProvider(),
    })
    const piSessionPath = session.getSessionFile()
    if (!piSessionPath) throw new Error('Pi Session did not provide a persistent JSONL file')
    config.piSessionPath = resolve(piSessionPath)
    const redactor = createSecretRedactor([config.apiKey])
    const opened: OpenRuntimeSession = {
      sessionId: config.sessionId,
      config,
      session,
      extensionUi: new ExtensionUiBroker((event) => this.emitSessionPayload(opened, event)),
      unsubscribe: () => undefined,
      redactor,
      pendingReplacement: undefined,
    }
    this.opened = opened

    try {
      this.emitDiagnostics(opened)
      this.emitSessionPayload(opened, {
        type: 'session.bound',
        piSessionId: session.getSessionId(),
        piSessionPath: resolve(piSessionPath),
      })
      if (session.bindExtensionUi) {
        await session.bindExtensionUi(opened.extensionUi.createContext(), {
          commandContextActions: this.createCommandContextActions(opened),
          beforeSessionInvalidate: () => opened.unsubscribe(),
          afterRebind: () => {
            this.rebindOpenedSession(opened, opened.session)
            return this.commitPendingReplacement(opened)
          },
          onError: (error) => this.handleExtensionError(opened, error),
        })
      } else {
        this.rebindOpenedSession(opened, session)
      }
      return opened
    } catch (error) {
      await this.closeOpenedSession(opened)
      throw error
    }
  }

  private async closeOpenedSession(opened: OpenRuntimeSession): Promise<void> {
    if (this.opened === opened) this.opened = null
    opened.unsubscribe()
    opened.extensionUi.cancelAll()
    await Promise.resolve(opened.session.dispose())
  }

  private rebindOpenedSession(opened: OpenRuntimeSession, session: PiSessionLike): void {
    if (this.opened !== opened) return
    opened.unsubscribe()
    opened.session = session
    opened.unsubscribe = session.subscribe((event) => this.handlePiEvent(opened, event))
  }

  private createCommandContextActions(opened: OpenRuntimeSession): ExtensionCommandContextActions {
    return {
      waitForIdle: () => opened.session.waitForIdle(),
      newSession: (options) =>
        this.replaceSession(
          opened,
          'new',
          async (withSession) => {
            if (!opened.session.newSession) throw new Error('Pi Session replacement is unavailable')
            return opened.session.newSession({ ...options, withSession })
          },
          undefined,
          options?.withSession,
        ),
      fork: (entryId, options) =>
        this.replaceSession(
          opened,
          'fork',
          (withSession) => opened.session.fork(entryId, { ...options, withSession }),
          undefined,
          options?.withSession,
        ),
      navigateTree: async (targetId, options) => {
        const result = await opened.session.navigateTree(targetId, {
          summarize: options?.summarize ?? false,
          ...(options?.customInstructions
            ? { customInstructions: options.customInstructions }
            : {}),
        })
        if (!result.cancelled) {
          this.emitSessionPayload(opened, {
            type: 'session.activeLeafChanged',
            activeLeafId: opened.session.getActiveLeafId(),
          })
        }
        return { cancelled: result.cancelled }
      },
      switchSession: (sessionPath, options) =>
        this.replaceSession(
          opened,
          'switch',
          async (withSession) => {
            if (!opened.session.switchSession)
              throw new Error('Pi Session replacement is unavailable')
            return opened.session.switchSession(sessionPath, { ...options, withSession })
          },
          sessionPath,
          options?.withSession,
        ),
      reload: async () => {
        await opened.session.reload?.()
      },
    }
  }

  private async replaceSession<T extends { cancelled: boolean }>(
    opened: OpenRuntimeSession,
    kind: 'new' | 'fork' | 'switch',
    invoke: (withSession: (context: ReplacementContext) => Promise<void>) => Promise<T | undefined>,
    targetSessionPath?: string,
    withSession: (context: ReplacementContext) => Promise<void> = async () => undefined,
  ): Promise<T> {
    const operationId = randomUUID()
    const targetSessionId = randomUUID()
    const prepared = await this.requestReplacement({
      type: 'session.replacement.requested',
      operationId,
      phase: 'prepare',
      kind,
      sourceSessionId: opened.sessionId,
      targetSessionId,
      targetSessionPath: targetSessionPath ? resolve(targetSessionPath) : null,
      piSessionId: null,
      piSessionPath: null,
      cwd: null,
      sourcePiSessionPath: opened.config.piSessionPath ?? null,
    })
    if (!prepared.accepted) return { cancelled: true } as T
    const resolvedTargetSessionId = prepared.targetSessionId ?? targetSessionId

    opened.pendingReplacement = {
      operationId,
      kind,
      sourceSessionId: opened.sessionId,
      targetSessionId: resolvedTargetSessionId,
      commitRequested: false,
    }
    try {
      const result = await invoke(withSession)
      if (result?.cancelled) await this.abortPendingReplacement(opened, operationId)
      return result ?? ({ cancelled: false } as T)
    } catch (error) {
      if (!opened.pendingReplacement?.commitRequested) {
        await this.abortPendingReplacement(opened, operationId)
      } else if (this.opened === opened) {
        await this.abortPendingReplacement(opened, operationId)
        await this.closeOpenedSession(opened)
      }
      throw error
    } finally {
      opened.pendingReplacement = undefined
    }
  }

  private async commitPendingReplacement(opened: OpenRuntimeSession): Promise<void> {
    const pending = opened.pendingReplacement
    if (!pending) return
    const piSessionPath = opened.session.getSessionFile()
    if (!piSessionPath) throw new Error('Pi Session replacement did not provide a JSONL file')
    pending.commitRequested = true
    const accepted = await this.requestReplacement({
      type: 'session.replacement.requested',
      operationId: pending.operationId,
      phase: 'commit',
      kind: pending.kind,
      sourceSessionId: pending.sourceSessionId,
      targetSessionId: pending.targetSessionId,
      targetSessionPath: null,
      piSessionId: opened.session.getSessionId(),
      piSessionPath: resolve(piSessionPath),
      cwd: opened.session.getCwd?.() ?? opened.config.projectRoot,
      sourcePiSessionPath: opened.config.piSessionPath ?? null,
    })
    if (!accepted.accepted) throw new Error(accepted.message ?? 'Session replacement was rejected')
    const sourceSessionId = opened.sessionId
    const cwd = opened.session.getCwd?.() ?? opened.config.projectRoot
    opened.sessionId = pending.targetSessionId
    opened.config = {
      ...opened.config,
      sessionId: pending.targetSessionId,
      piSessionPath: resolve(piSessionPath),
      projectRoot: cwd,
    }
    if (this.current?.session === opened.session) this.current.cancelled = true
    this.emitSessionPayload(opened, {
      type: 'session.replaced',
      sourceSessionId,
      targetSessionId: pending.targetSessionId,
      piSessionId: opened.session.getSessionId(),
      piSessionPath: resolve(piSessionPath),
      cwd,
      activeLeafId: opened.session.getActiveLeafId(),
    })
  }

  private async abortPendingReplacement(
    opened: OpenRuntimeSession,
    operationId: string,
  ): Promise<void> {
    const pending = opened.pendingReplacement
    if (!pending || pending.operationId !== operationId) return
    await this.requestReplacement({
      type: 'session.replacement.requested',
      operationId,
      phase: 'abort',
      kind: pending.kind,
      sourceSessionId: pending.sourceSessionId,
      targetSessionId: pending.targetSessionId,
      targetSessionPath: null,
      piSessionId: null,
      piSessionPath: null,
      cwd: null,
      sourcePiSessionPath: opened.config.piSessionPath ?? null,
    })
  }

  private async requestReplacement(
    request: RuntimeSessionReplacementRequest,
  ): Promise<{ accepted: boolean; targetSessionId?: string; message?: string }> {
    return this.requestSessionReplacement?.(request) ?? { accepted: true }
  }

  private handleExtensionError(opened: OpenRuntimeSession, error: ExtensionError): void {
    this.emitSessionPayload(opened, {
      type: 'runtime.diagnostic',
      severity: 'error',
      message: `${error.event}: ${error.error}`,
    })
  }

  async fork(config: RuntimeForkConfig): Promise<AgentRuntimeForkResult> {
    if (this.current || this.sessionOperation)
      throw new Error('Only one Runtime operation can be active')
    if (this.opened) await this.closeOpenedSession(this.opened)
    const sourcePiSessionPath = configuredSessionPath({
      sourcePiSessionPath: config.sourcePiSessionPath,
    })
    const redactor = createSecretRedactor([config.apiKey])
    const eventConfig: RuntimeStartConfig = {
      type: 'start',
      runId: config.operationId,
      sessionId: config.sourceSessionId,
      messageId: config.operationId,
      projectRoot: config.projectRoot,
      agentDirectory: config.agentDirectory,
      sessionDirectory: dirname(sourcePiSessionPath),
      piSessionPath: sourcePiSessionPath,
      resumeSession: true,
      settings: config.settings,
      apiKey: config.apiKey,
      prompt: 'Fork Pi Session',
    }
    const broker = new ExtensionUiBroker((event) =>
      this.emitOperationPayload(config.sourceSessionId, redactor, event),
    )
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
        sessionFile: sourcePiSessionPath,
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

      const piSessionPath = session.getSessionFile()
      if (!piSessionPath) throw new Error('Forked Pi Session did not provide a JSONL file')
      if (resolve(piSessionPath) === sourcePiSessionPath) {
        throw new Error('Pi Fork did not create an independent Session file')
      }
      const piSessionId = session.getSessionId()
      await sanitizePiTranscript(resolve(piSessionPath), redactor)
      await session.dispose()
      disposed = true
      return { outcome: 'completed', piSessionId, piSessionPath: resolve(piSessionPath) }
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
    if (this.opened) await this.closeOpenedSession(this.opened)
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
    const broker = new ExtensionUiBroker((event) =>
      this.emitOperationPayload(config.targetSessionId, redactor, event),
    )
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
      const piSessionId = session.getSessionId()
      await sanitizePiTranscript(importedSessionFile, redactor)
      await session.dispose()
      disposed = true
      if (initialSessionFile && resolve(initialSessionFile) !== resolve(importedSessionFile)) {
        await unlink(initialSessionFile).catch(() => undefined)
      }
      completed = true
      return { outcome: 'completed', piSessionId, piSessionPath: resolve(importedSessionFile) }
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
    if (this.opened) await this.closeOpenedSession(this.opened)
    const sourcePath = configuredSessionPath({
      sourcePiSessionPath: config.sourcePiSessionPath,
    })
    if (!isAbsolute(config.destinationPath)) {
      throw new Error('Pi Session export destination must be absolute')
    }
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
    const temporarySessionDirectory = await mkdtemp(resolve(dirname(sourcePath), '.pictor-export-'))
    const eventConfig: RuntimeStartConfig = {
      type: 'start',
      runId: config.operationId,
      sessionId: config.sourceSessionId,
      messageId: config.operationId,
      projectRoot: config.projectRoot,
      agentDirectory: config.agentDirectory,
      sessionDirectory: temporarySessionDirectory,
      resumeSession: true,
      piSessionPath: sourcePath,
      activeLeafId: config.activeLeafId,
      settings: config.settings,
      apiKey: config.apiKey,
      prompt: 'Export Pi Session',
    }
    const broker = new ExtensionUiBroker((event) =>
      this.emitOperationPayload(config.sourceSessionId, redactor, event),
    )
    this.sessionOperation = {
      operationId: config.operationId,
      kind: 'export',
      broker,
      session: null,
      cancelRequested: false,
    }
    let session: PiSessionLike | null = null

    try {
      const temporarySessionPath = resolve(temporarySessionDirectory, basename(sourcePath))
      await copyFile(sourcePath, temporarySessionPath)
      session = await this.sessionFactory({
        config: eventConfig,
        sessionFile: temporarySessionPath,
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
    if (this.opened) await this.closeOpenedSession(this.opened)
    const sourcePiSessionPath = configuredSessionPath({
      sourcePiSessionPath: config.sourcePiSessionPath,
    })
    const redactor = createSecretRedactor([config.apiKey])
    const eventConfig: RuntimeStartConfig = {
      type: 'start',
      runId: config.operationId,
      sessionId: config.sourceSessionId,
      messageId: config.operationId,
      projectRoot: config.projectRoot,
      agentDirectory: config.agentDirectory,
      sessionDirectory: dirname(sourcePiSessionPath),
      piSessionPath: sourcePiSessionPath,
      resumeSession: true,
      activeLeafId: config.activeLeafId,
      settings: config.settings,
      apiKey: config.apiKey,
      prompt: 'Navigate Pi Session Tree',
    }
    const broker = new ExtensionUiBroker((event) =>
      this.emitOperationPayload(config.sourceSessionId, redactor, event),
    )
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
        sessionFile: sourcePiSessionPath,
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
      await sanitizePiTranscript(sourcePiSessionPath, redactor)
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
    if (this.opened) await this.closeOpenedSession(this.opened)
    const sourcePiSessionPath = configuredSessionPath({
      sourcePiSessionPath: config.sourcePiSessionPath,
    })
    const redactor = createSecretRedactor([config.apiKey])
    const eventConfig: RuntimeStartConfig = {
      type: 'start',
      runId: config.operationId,
      sessionId: config.sourceSessionId,
      messageId: config.operationId,
      projectRoot: config.projectRoot,
      agentDirectory: config.agentDirectory,
      sessionDirectory: dirname(sourcePiSessionPath),
      piSessionPath: sourcePiSessionPath,
      resumeSession: true,
      activeLeafId: config.activeLeafId,
      settings: config.settings,
      apiKey: config.apiKey,
      prompt: 'Compact Pi Session',
    }
    const broker = new ExtensionUiBroker((event) =>
      this.emitOperationPayload(config.sourceSessionId, redactor, event),
    )
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
        sessionFile: sourcePiSessionPath,
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
      await sanitizePiTranscript(sourcePiSessionPath, redactor)
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

  async labelSessionEntry(config: RuntimeLabelConfig): Promise<AgentRuntimeLabelResult> {
    if (this.current || this.sessionOperation)
      throw new Error('Only one Runtime operation can be active')
    if (this.opened) await this.closeOpenedSession(this.opened)
    const sourcePiSessionPath = configuredSessionPath({
      sourcePiSessionPath: config.sourcePiSessionPath,
    })
    const eventConfig: RuntimeStartConfig = {
      type: 'start',
      runId: config.operationId,
      sessionId: config.sourceSessionId,
      messageId: config.operationId,
      projectRoot: config.projectRoot,
      agentDirectory: config.agentDirectory,
      sessionDirectory: dirname(sourcePiSessionPath),
      piSessionPath: sourcePiSessionPath,
      resumeSession: true,
      activeLeafId: config.activeLeafId,
      settings: config.settings,
      apiKey: config.apiKey,
      prompt: 'Label Pi Session Entry',
    }
    const broker = new ExtensionUiBroker((event) =>
      this.emitOperationPayload(
        config.sourceSessionId,
        createSecretRedactor([config.apiKey]),
        event,
      ),
    )
    this.sessionOperation = {
      operationId: config.operationId,
      kind: 'label',
      broker,
      session: null,
      cancelRequested: false,
    }
    let session: PiSessionLike | null = null
    try {
      session = await this.sessionFactory({
        config: eventConfig,
        sessionFile: sourcePiSessionPath,
        extensionPaths: this.extensionPaths,
        skillPaths: this.skillPaths,
        promptPaths: this.promptPaths,
        modelProvider: this.getModelProvider(),
      })
      if (this.sessionOperation?.operationId === config.operationId) {
        this.sessionOperation.session = session
      }
      session.labelEntry(config.entryId, config.label ?? undefined)
      const activeLeafId = session.getActiveLeafId()
      if (!activeLeafId) throw new Error('Pi Label did not provide an active leaf')
      await sanitizePiTranscript(sourcePiSessionPath, createSecretRedactor([config.apiKey]))
      return { outcome: 'completed', activeLeafId }
    } finally {
      broker.cancelAll()
      if (session) await Promise.resolve(session.dispose()).catch(() => undefined)
      if (this.sessionOperation?.operationId === config.operationId) this.sessionOperation = null
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

  async abort(runId: string): Promise<boolean> {
    const current = this.current
    if (!current || current.config.runId !== runId) return false
    current.cancelled = true
    current.abortController.abort(new Error('Run stopped'))
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
    if (this.opened) await this.closeOpenedSession(this.opened)
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
    if (this.opened?.extensionUi.respond(requestId, value)) return
    this.sessionOperation?.broker.respond(requestId, value)
  }

  updateComposerText(sessionId: string, text: string): void {
    if (this.opened?.sessionId !== sessionId) return
    this.opened.extensionUi.updateEditorText(text)
  }

  async reloadResources(sessionId: string): Promise<void> {
    if (this.current) throw new Error('Cannot reload Pi resources during an active Run')
    if (!this.opened || this.opened.sessionId !== sessionId) {
      throw new Error('Requested Pi Session is not open')
    }
    await this.opened.session.reload?.()
  }

  getRuntimeControls(sessionId: string) {
    const opened = this.opened
    if (!opened || opened.sessionId !== sessionId) return null
    const availableTools = [
      ...new Set((opened.session.getAllTools?.() ?? []).map((tool) => tool.name)),
    ]
    return {
      type: 'host.controlsResult' as const,
      sessionId,
      modelId: opened.session.getModelId?.() ?? null,
      thinkingLevel: opened.session.getThinkingLevel?.() ?? 'off',
      activeTools: opened.session.getActiveToolNames?.() ?? [],
      availableTools,
      steeringMode: opened.session.getSteeringMode?.() ?? 'one-at-a-time',
      followUpMode: opened.session.getFollowUpMode?.() ?? 'one-at-a-time',
    }
  }

  async setRuntimeControls(
    sessionId: string,
    controls: {
      modelId: string | null
      thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
      activeTools: string[]
      steeringMode: 'all' | 'one-at-a-time'
      followUpMode: 'all' | 'one-at-a-time'
    },
  ): Promise<void> {
    const opened = this.opened
    if (!opened || opened.sessionId !== sessionId) return
    if (controls.modelId && controls.modelId !== opened.session.getModelId?.()) {
      const modelRuntime = opened.session.getModelRuntime?.()
      if (!modelRuntime || !opened.session.setModel) {
        throw new Error('Pi Session model switching is unavailable')
      }
      const model = this.getModelProvider().register(
        modelRuntime,
        { ...opened.config.settings, modelId: controls.modelId },
        opened.config.apiKey,
      )
      await opened.session.setModel(model)
      opened.config.settings = { ...opened.config.settings, modelId: controls.modelId }
      if (opened.config.runtimePreferences) {
        opened.config.runtimePreferences = {
          ...opened.config.runtimePreferences,
          modelId: controls.modelId,
        }
      }
    }
    opened.session.setActiveToolNames?.(controls.activeTools)
    opened.session.setThinkingLevel?.(controls.thinkingLevel)
    opened.session.setSteeringMode?.(controls.steeringMode)
    opened.session.setFollowUpMode?.(controls.followUpMode)
  }

  private getModelProvider(): ModelRuntimeProvider {
    if (this.modelProviders.length === 0) throw new Error('No Model Runtime Provider is active')
    if (this.modelProviders.length > 1)
      throw new Error('Multiple Model Runtime Providers are active')
    return this.modelProviders[0]!
  }

  private emitDiagnostics(opened: OpenRuntimeSession): void {
    for (const diagnostic of opened.session.getDiagnostics?.() ?? []) {
      this.emitSessionPayload(opened, {
        type: 'runtime.diagnostic',
        severity: diagnostic.type,
        message: diagnostic.message,
      })
    }
  }

  private handlePiEvent(opened: OpenRuntimeSession, event: AgentSessionEvent): void {
    const current =
      this.current?.session === opened.session && !this.current.cancelled ? this.current : undefined
    if (event.type === 'auto_retry_start') {
      this.emitRunOrSessionEvent(current, opened, {
        type: 'retry.stateChanged',
        status: 'scheduled',
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        delayMs: event.delayMs,
        error: event.errorMessage,
      })
      return
    }
    if (event.type === 'auto_retry_end') {
      this.emitRunOrSessionEvent(current, opened, {
        type: 'retry.stateChanged',
        status: event.success ? 'completed' : 'failed',
        attempt: event.attempt,
        maxAttempts: null,
        delayMs: null,
        error: event.finalError ?? null,
      })
      return
    }
    if (event.type === 'session_info_changed') {
      this.emitSessionPayload(opened, {
        type: 'session.infoChanged',
        name: event.name ?? null,
      })
      return
    }
    if (event.type === 'thinking_level_changed') {
      this.emitSessionPayload(opened, {
        type: 'session.thinkingLevelChanged',
        level: event.level,
      })
      return
    }
    if (event.type === 'compaction_start' || event.type === 'compaction_end') {
      if (current) this.handleCompactionEvent(current.config, event)
      else this.handleSessionCompactionEvent(opened, event)
      return
    }
    if (!current) return
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
      const prefix = current.thinkingStarted && !current.textStarted ? '\n\n' : ''
      current.textStarted = true
      current.text += prefix + event.assistantMessageEvent.delta
      this.emitEvent(current.config, {
        type: 'message.delta',
        messageId: current.config.messageId,
        delta: prefix + event.assistantMessageEvent.delta,
      })
      return
    }
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'thinking_delta') {
      const prefix = current.thinkingStarted ? '' : 'Thinking\n\n'
      current.thinkingStarted = true
      current.text += prefix + event.assistantMessageEvent.delta
      this.emitEvent(current.config, {
        type: 'message.delta',
        messageId: current.config.messageId,
        delta: prefix + event.assistantMessageEvent.delta,
      })
      return
    }
    if (event.type === 'queue_update') {
      this.emitEvent(current.config, {
        type: 'queue.updated',
        steering: [...event.steering],
        followUp: [...event.followUp],
      })
      return
    }
    if (event.type === 'tool_execution_start') {
      const kind = toolKinds[event.toolName as keyof typeof toolKinds] ?? 'custom'
      const path = toolPath(current.config.projectRoot, event.args)
      this.emitEvent(current.config, {
        type: 'tool.started',
        callId: event.toolCallId,
        kind,
        label: path ?? event.toolName,
        path,
      })
      return
    }
    if (event.type === 'tool_execution_update') {
      this.emitEvent(current.config, {
        type: 'tool.updated',
        callId: event.toolCallId,
        output: outputText(event.partialResult),
      })
      return
    }
    if (event.type === 'tool_execution_end') {
      this.emitEvent(current.config, {
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
        this.emitEvent(current.config, {
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

  private handleSessionCompactionEvent(opened: OpenRuntimeSession, event: AgentSessionEvent): void {
    if (event.type === 'compaction_start') {
      this.emitSessionPayload(opened, {
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
    this.emitSessionPayload(opened, {
      type: 'compaction.stateChanged',
      status: event.aborted ? 'cancelled' : event.errorMessage ? 'failed' : 'completed',
      reason: event.reason,
      tokensBefore: event.result?.tokensBefore ?? null,
      estimatedTokensAfter: event.result?.estimatedTokensAfter ?? null,
      error: event.errorMessage ?? null,
    })
  }

  private emitRunOrSessionEvent(
    current: ActiveRuntime | undefined,
    opened: OpenRuntimeSession,
    event: RuntimeEventPayload,
  ): void {
    if (current) this.emitEvent(current.config, event)
    else this.emitSessionPayload(opened, event)
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

  private emitSessionPayload(opened: OpenRuntimeSession | null, event: RuntimeEventPayload): void {
    if (!opened) return
    const completeEvent = runtimeEventSchema.parse({
      ...event,
      runId: null,
      sessionId: opened.sessionId,
      at: new Date().toISOString(),
    })
    this.emit(opened.redactor.redactRuntimeEvent(completeEvent))
  }

  private emitOperationPayload(
    sessionId: string,
    redactor: SecretRedactor,
    event: RuntimeEventPayload,
  ): void {
    const completeEvent = runtimeEventSchema.parse({
      ...event,
      runId: null,
      sessionId,
      at: new Date().toISOString(),
    })
    this.emit(redactor.redactRuntimeEvent(completeEvent))
  }
}
