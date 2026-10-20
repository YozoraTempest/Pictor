import type {
  CcSwitchProviderSummary,
  ChatEvent,
  ChatHistoryPage,
  JsonValue,
  ModelEntry,
  ModelProtocol,
  ModelSettings,
  ModelSettingsInput,
  PluginRecord,
  Project,
  Section,
  Session,
  SettingsMap,
} from '@pictor/shared'

export interface AppInfo {
  name: string
  version: string
  electron: string
  node: string
  hostCore: string
  database: string
}

export interface HostSnapshot {
  projects: Project[]
  sessions: Session[]
  sections: Section[]
  settings: SettingsMap
}

export interface CommandDescriptor {
  id: string
  description: string
  source: 'core' | 'plugin'
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
  createSession(projectId: string | null, title: string): Promise<Session>
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

  listCommands(): Promise<CommandDescriptor[]>
  executeCommand(id: string, input?: JsonValue): Promise<unknown>

  listPlugins(): Promise<PluginRecord[]>
  setPluginEnabled(id: string, enabled: boolean): Promise<PluginRecord>
  pluginReport(): Promise<PluginReport>

  getAppInfo(): Promise<AppInfo>

  getModelSettings(): Promise<ModelSettings>
  saveModelSettings(input: ModelSettingsInput): Promise<ModelSettings>
  fetchModels(input?: {
    baseUrl?: string
    protocol?: ModelProtocol
    apiKey?: string
  }): Promise<ModelEntry[]>
  testModelConnection(): Promise<ModelProbeResult>
  scanCcSwitch(): Promise<CcSwitchScanResult>
  importCcSwitchProvider(id: string, includeApiKey: boolean): Promise<ModelSettings>
  runAgentTest(prompt: string, workingDirectory: string): Promise<AgentTestResult>

  openChat(sessionId: string): Promise<OpenChatResult>
  sendChat(prompt: string): Promise<void>
  stopChat(): Promise<void>
  closeChat(): Promise<void>
  chatHistory(path: string, limit: number, offset: number): Promise<ChatHistoryPage>
  onChatEvent(listener: (event: ChatEvent) => void): () => void
}
