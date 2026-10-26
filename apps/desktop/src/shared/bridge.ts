import type {
  ApprovalMode,
  ApprovalRequest,
  ChatAnswer,
  ChatImage,
  ChatQuestionRequest,
  ForkPoint,
  CcSwitchProviderSummary,
  ProviderInput,
  ProviderList,
  ChatEvent,
  ChatHistoryPage,
  JsonValue,
  ModelEffort,
  ModelEntry,
  ModelProtocol,
  ModelSettings,
  ModelSettingsInput,
  PluginRecord,
  Project,
  Section,
  Session,
  SettingsMap,
  SkillEntry,
  ToolRule,
} from '@pictor/shared'

export interface AppInfo {
  name: string
  version: string
  electron: string
  node: string
  hostCore: string
  database: string
}

export type WindowCommand =
  | 'minimize'
  | 'toggleMaximize'
  | 'close'
  | 'reload'
  | 'toggleDevTools'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'selectAll'

export interface WindowState {
  maximized: boolean
}

export interface HostSnapshot {
  projects: Project[]
  sessions: Session[]
  sections: Section[]
  settings: SettingsMap
}
/**
 * One entry in the side panel. Built-in panels use the same shape on the
 * renderer side; plugin panels arrive from the `panels` contribution point.
 */
export interface PanelDescriptor {
  id: string
  title: string
  description?: string
  icon?: string
  command: string
}

/**
 * Presentation for one agent tool, contributed by a plugin.
 *
 * Data only: the renderer maps `icon` to its own icon set, so a plugin never
 * ships a component and the transcript never renders plugin code.
 */
export interface ToolViewDescriptor {
  id: string
  tools: string[]
  label?: string
  icon?: string
}
export type PermissionMode = 'read-only' | 'workspace-write' | 'danger-full-access'

/**
 * What one kernel can actually do.
 *
 * A kernel that cannot express something must not have a control in the window
 * pretending it can: a CLI with no sandbox still showed a permission picker, and
 * a picker that errors is worse than an absent one. Each driver declares what it
 * really offers, and the controls read that instead of assuming the default.
 */
export interface KernelCapabilities {
  /** A sandbox mode the kernel applies per conversation. */
  permission: boolean
  /**
   * The kernel lets Pictor decide when a call waits for a person.
   *
   * dsh answers this with its own sandbox and approval policy, so the switch is its
   * own; a kernel without a sandbox can still hold a call, and this is the promise
   * that the switch in the composer will mean something there.
   */
  approval: boolean
  /** The model chosen in Pictor reaches the kernel, effort included. */
  model: boolean
  /** The kernel exposes a skill catalog that a turn can load from. */
  skills: boolean
  /** The kernel can branch a conversation at a message boundary. */
  fork: boolean
}

/** One model a kernel can run, in that kernel's own words. */
export interface KernelModel {
  /** What the kernel calls it; opaque to Pictor. */
  id: string
  /** Human name, falling back to the id. */
  label: string
  provider: string | null
  /** Whether this model accepts images. */
  images: boolean
  contextWindow: number | null
  /**
   * Levels this model accepts, weakest first, when the kernel declares them.
   *
   * `null` means the kernel said nothing, which is not the same as "none": the
   * composer then offers no level control instead of an empty one.
   */
  efforts: ModelEffort[] | null
}

/** One conversation's model state, in the kernel's own words. */
export interface KernelModelState {
  models: KernelModel[]
  /** The model this conversation is running, or null before it has run. */
  activeId: string | null
  /** The thinking level in effect, or null when the kernel's own default applies. */
  activeEffort: ModelEffort | null
}

/**
 * Whose model set the composer's picker should show.
 *
 * `pictor` is the app's own provider list, which dsh is booted with; `kernel` means
 * the kernel has its own catalogue and answers for it; null means there is nothing
 * to choose — a kernel that runs whatever it was configured with.
 */
export type KernelModelSource = 'pictor' | 'kernel' | null

/** What one kernel looks like from the renderer's side. */
/**
 * One kernel plugin, as the settings page lists it.
 *
 * `services` is the trust sentence: these are the host services the plugin asked
 * for, and a kernel cannot run a turn without reaching at least the model service.
 */
export interface KernelPluginInfo {
  /** Kernel id once mounted; the directory or `builtin:<n>` when it failed. */
  id: string
  label: string
  /** `builtin`, or the directory under the profile that holds it. */
  source: string
  /** Host services the plugin declared with `inject`. */
  services: string[]
  available: boolean
  /** Why it could not be used, when it could not. */
  failure: string | null
}

/** A message an extension asked to show; the kernel sent it, not Pictor. */
export interface KernelNotice {
  message: string
  level: 'info' | 'error'
}

/**
 * One installed plugin, as the settings page shows it.
 *
 * A plugin is one installation that may contribute several things: panels, guards,
 * skills, a kernel. The page lists installations rather than contributions, because
 * that is what a person installed and what they would remove.
 */
export interface PluginOverview {
  /** Installation name: the directory or package this came from. */
  name: string
  /** The plugin's own id, from its manifest. */
  id: string
  label: string
  version: string
  /** `builtin` for what ships with the app. */
  source: string
  enabled: boolean
  /** How many contributions it made, per point. */
  contributions: Array<{ point: string; count: number }>
  /** Kernels it mounted, with the host services each declared. */
  kernels: Array<{ id: string; label: string; services: string[]; available: boolean }>
  /** Why it is not running, when it is not. */
  failure: string | null
}

/** A setting one kernel declares, in the shape the page draws. */
export interface KernelSettingInfo {
  /** Which kernel owns it. */
  kernel: string
  key: string
  label: string
  description: string
  /** What the current value means, in one line. */
  hint: string
  value: boolean
}

/** A kernel compiled into the app; it can be turned off, never removed. */
export interface BuiltinKernelInfo {
  id: string
  label: string
  /** False when a person turned it off; it is not mounted then. */
  enabled: boolean
  /** Where new conversations start. */
  default: boolean
  /** Host services it declared, when it is mounted. */
  services: string[]
}

/** What an install or removal did, in one line the page can show. */
export interface KernelChangeResult {
  ok: boolean
  /** Kernel id once mounted, or the name it would have used. */
  id: string | null
  /** Why it failed, or an empty string. */
  message: string
}

export interface KernelInfo {
  id: string
  label: string
  default: boolean
  available: boolean
  capabilities: KernelCapabilities
  modelSource: KernelModelSource
}

/** Status of one kernel: whether it can run, what it runs with, why it failed. */
export interface HarnessStatus {
  state: 'stopped' | 'starting' | 'ready' | 'error'
  /** Launcher path, or null when no runtime is installed. */
  binary: string | null
  /** Version the launcher on this machine reports, or null when unreadable. */
  version: string | null
  /** Version this build pins; a difference is what "stale" means. */
  expectedVersion: string | null
  /** Runtime home: profiles, session logs and storages live here. */
  home: string
  provider: string | null
  model: string | null
  serverInfo: { name: string; version: string } | null
  /** Sandbox mode the runtime is (or will be) booted with. */
  permissionMode: PermissionMode
  error: string | null
}

export interface CcSwitchScanResult {
  available: boolean
  path: string
  providers: CcSwitchProviderSummary[]
}

export interface ModelProbeResult {
  ok: boolean
  message: string
  sample: string
}

export interface AgentTestResult {
  ok: boolean
  text: string
  events: string[]
  message?: string
}

export interface OpenChatResult {
  path: string
  history: ChatHistoryPage
}

export interface PluginReport {
  activated: string[]
  skipped: string[]
  failures: Array<{ source: string; reason: string }>
}

/**
 * The only API the renderer sees. It is a narrow, serialisable contract; no Node
 * or Electron object crosses the context bridge.
 */
export interface PictorBridge {
  getSnapshot(): Promise<HostSnapshot>
  addProject(path: string, name?: string): Promise<Project>
  removeProject(id: string): Promise<void>
  setProjectSection(id: string, sectionId: string | null): Promise<Project>
  reorderSections(ids: string[]): Promise<Section[]>
  addProjectFolder(id: string, path: string): Promise<string[]>
  removeProjectFolder(id: string, path: string): Promise<string[]>
  /**
   * Creates a conversation.
   *
   * `parentId` records lineage: a branch — including switching kernels, which is
   * only expressible as a branch — points at the conversation it came from.
   */
  createSession(
    projectId: string | null,
    title: string,
    kernelId?: string,
    parentId?: string,
  ): Promise<Session>
  deleteSession(id: string): Promise<void>
  setSessionPinned(id: string, pinned: boolean): Promise<Session>
  setSessionArchived(id: string, archived: boolean): Promise<Session>
  archiveSessions(ids: string[]): Promise<number>
  reorderSessions(ids: string[]): Promise<number>
  setSessionProject(id: string, projectId: string | null): Promise<Session>
  setSessionSections(id: string, sectionIds: string[]): Promise<Session>
  pickDirectory(): Promise<string | null>

  listSections(): Promise<Section[]>
  createSection(name: string): Promise<Section>
  renameSection(id: string, name: string): Promise<Section>
  removeSection(id: string): Promise<void>

  putSetting(key: string, value: JsonValue): Promise<void>

  windowCommand(command: WindowCommand): Promise<void>
  getWindowState(): Promise<WindowState>
  onWindowState(listener: (state: WindowState) => void): () => void

  listPanels(): Promise<PanelDescriptor[]>
  invokePanel(id: string): Promise<unknown>
  listToolViews(): Promise<ToolViewDescriptor[]>

  listPlugins(): Promise<PluginRecord[]>
  setPluginEnabled(id: string, enabled: boolean): Promise<PluginRecord>
  pluginReport(): Promise<PluginReport>

  harnessStatus(): Promise<HarnessStatus>
  harnessStart(cwd: string): Promise<HarnessStatus>
  harnessStop(): Promise<HarnessStatus>
  /** Install the pinned runtime into the profile; resolves when npm exits. */
  installHarness(): Promise<HarnessStatus>
  /** Default sandbox mode for conversations created later; applied live. */
  setHarnessPermissionMode(mode: PermissionMode): Promise<HarnessStatus>
  /** Sandbox mode the conversation behind `sessionId` is running under. */
  getSessionPermission(sessionId: string): Promise<PermissionMode | null>
  /** Switches one conversation's sandbox mode, without a restart. */
  setSessionPermission(sessionId: string, mode: PermissionMode): Promise<PermissionMode | null>
  /** Every kernel this build can drive, for the picker. */
  listKernels(): Promise<KernelInfo[]>
  /** Messages extensions asked to show, already trimmed by the main process. */
  onKernelNotice(callback: (notice: KernelNotice) => void): () => void
  /** Every kernel plugin: mounted, installed but broken, or built in. */
  listKernelPlugins(): Promise<KernelPluginInfo[]>
  /** Every installed plugin, with what it contributes and what it can reach. */
  listPluginOverview(): Promise<PluginOverview[]>
  /** Settings the mounted kernels declare; each names the kernel that owns it. */
  kernelSettings(): Promise<KernelSettingInfo[]>
  /** Writes one declared setting; false when no mounted kernel owns that key. */
  setKernelSetting(key: string, value: boolean): Promise<boolean>
  /** The kernels compiled into the app, mounted or turned off. */
  listBuiltinKernels(): Promise<BuiltinKernelInfo[]>
  /** Turns a built-in kernel off or on; resolves with the new state. */
  setBuiltinKernelEnabled(id: string, enabled: boolean): Promise<boolean>
  /** Chooses where new conversations start; false when that kernel is not present. */
  setDefaultKernel(id: string): Promise<boolean>
  /** Ask for a directory; null when the person cancelled. */
  chooseKernelFolder(): Promise<string | null>
  /** Install a directory as a kernel. */
  installKernelFolder(path: string): Promise<KernelChangeResult>
  /** Install a package as a kernel; the package manager runs in the profile. */
  installKernelPackage(spec: string): Promise<KernelChangeResult>
  /** Remove an installed kernel by id; built-ins are refused. */
  removeKernel(id: string): Promise<KernelChangeResult>
  /** Every kernel's status, by kernel id — one entry per kernel this build drives. */
  kernelStatuses(): Promise<Record<string, HarnessStatus>>
  /** The models a kernel offers for one conversation. */
  kernelModels(sessionId: string): Promise<KernelModelState>
  /** Selects one for that conversation, without a restart. */
  selectKernelModel(sessionId: string, id: string): Promise<void>
  /** Sets the conversation's thinking level, or clears it with null. */
  selectKernelEffort(sessionId: string, effort: ModelEffort | null): Promise<void>
  /** When this conversation's calls wait for a person, where the kernel allows it. */
  kernelApproval(sessionId: string): Promise<ApprovalMode>
  /** Sets that mode for the conversation; the next call follows it. */
  selectKernelApproval(sessionId: string, mode: ApprovalMode): Promise<void>
  /** Tools this conversation no longer asks about. */
  kernelGrants(sessionId: string): Promise<string[]>
  /** Answers a held call with "not this tool again in this conversation". */
  grantKernelTool(sessionId: string, tool: string): Promise<string[]>
  /** Forgets every such answer in the conversation. */
  revokeKernelGrants(sessionId: string): Promise<string[]>
  /** Per-tool rules: a deny refuses a call, an allow answers its escalation. */
  listToolRules(): Promise<ToolRule[]>
  saveToolRules(rules: ToolRule[]): Promise<ToolRule[]>
  /** Skills the conversation behind `sessionId` can see, for `/` and settings. */
  listSkills(sessionId: string): Promise<SkillEntry[]>
  /** Switches one skill on or off and answers with the new list. */
  setSkillEnabled(sessionId: string, name: string, enabled: boolean): Promise<SkillEntry[]>
  /** Reveals a file in the OS file manager; no-op when the path is unknown. */
  showInFolder(path: string): Promise<void>

  getAppInfo(): Promise<AppInfo>

  getModelSettings(): Promise<ModelSettings>
  /** Every configured provider, with whether each holds a key. */
  listProviders(): Promise<ProviderList>
  saveProvider(input: ProviderInput): Promise<ProviderList>
  removeProvider(id: string): Promise<ProviderList>
  activateProvider(id: string): Promise<ProviderList>
  saveModelSettings(input: ModelSettingsInput): Promise<ModelSettings>
  /** Switches the active model, leaving the endpoint and key untouched. */
  selectModel(modelId: string): Promise<ModelSettings>
  /** Uses one model of one service, switching the service when it differs. */
  useModel(providerId: string, modelId: string): Promise<ModelSettings>
  fetchModels(input?: {
    baseUrl?: string
    protocol?: ModelProtocol
    apiKey?: string
  }): Promise<ModelEntry[]>
  testModelConnection(): Promise<ModelProbeResult>
  scanCcSwitch(): Promise<CcSwitchScanResult>
  importCcSwitchProvider(id: string, includeApiKey: boolean): Promise<ProviderList>
  runAgentTest(prompt: string, workingDirectory: string): Promise<AgentTestResult>

  openChat(sessionId: string): Promise<OpenChatResult>
  sendChat(
    sessionId: string,
    prompt: string,
    images?: ChatImage[],
    effort?: ModelEffort | null,
  ): Promise<void>
  stopChat(sessionId: string): Promise<void>
  /**
   * Branches a conversation; returns the new session id.
   *
   * `atSeq` is an inclusive event boundary — one message's `seq` — and omitting
   * it copies the latest completed turn.
   */
  /**
   * Branches a conversation at one of its messages.
   *
   * The point is whatever the row carries — a durable event boundary for dsh, an
   * entry id for a kernel that forks by message — and the kernel takes what it can
   * address.
   */
  forkSession(sessionId: string, at?: ForkPoint): Promise<string>
  chatHistory(path: string, limit: number, offset: number): Promise<ChatHistoryPage>
  onChatEvent(listener: (event: ChatEvent) => void): () => void
  /** One line of the runtime install command, for the page that started it. */
  onHarnessInstall(listener: (line: string) => void): () => void
  /** Fires whenever the runtime starts, stops or fails; a transcript may be stale. */
  onHarnessStatus(listener: (status: HarnessStatus) => void): () => void
  /** Fires when the main process changed workspace metadata (a session title). */
  onWorkspaceChanged(listener: () => void): () => void
  /** Fires when the runtime holds a tool call until a decision arrives. */
  onApprovalRequest(listener: (request: ApprovalRequest) => void): () => void
  answerApproval(eventId: string, allow: boolean): Promise<void>
  /** Fires when the model asked something and the runtime is waiting on the answer. */
  onQuestionRequest(listener: (request: ChatQuestionRequest) => void): () => void
  /** Answer a pending question; `null` dismisses it and fails the tool call. */
  answerQuestions(eventId: string, answers: ChatAnswer[] | null): Promise<void>
}
