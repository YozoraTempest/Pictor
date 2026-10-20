import type {
  CcSwitchProviderSummary,
  JsonValue,
  ModelEntry,
  ModelProtocol,
  ModelSettings,
  ModelSettingsInput,
  PluginRecord,
  Project,
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
  createSession(projectId: string, title: string): Promise<Session>
  deleteSession(id: string): Promise<void>
  pickDirectory(): Promise<string | null>

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
}
