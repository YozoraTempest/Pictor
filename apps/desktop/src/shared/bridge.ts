import type { JsonValue, PluginRecord, Project, Session, SettingsMap } from '@pictor/shared'

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
}
