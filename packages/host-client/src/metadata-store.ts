import { RpcClient } from '@pictor/racp'
import type { RpcTransport } from '@pictor/racp'
import type {
  CcSwitchProviderDetail,
  CcSwitchProviderSummary,
  HostInfo,
  JsonValue,
  PluginRecord,
  Project,
  Session,
  SettingsMap,
} from '@pictor/shared'

/**
 * The only surface the application layer is allowed to use for metadata.
 *
 * Today the implementation is a Rust sidecar over JSON-RPC. Keeping this
 * interface free of transport types is what makes that swappable.
 */
export interface MetadataStore {
  ping(): Promise<{ ok: boolean }>
  info(): Promise<HostInfo>

  listProjects(): Promise<Project[]>
  addProject(path: string, name?: string): Promise<Project>
  removeProject(id: string): Promise<void>

  listSessions(projectId?: string): Promise<Session[]>
  createSession(projectId: string, title: string): Promise<Session>
  renameSession(id: string, title: string): Promise<Session>
  deleteSession(id: string): Promise<void>

  listSettings(): Promise<SettingsMap>
  putSetting(key: string, value: JsonValue): Promise<void>

  listPlugins(): Promise<PluginRecord[]>
  upsertPlugin(input: {
    id: string
    version: string
    enabled?: boolean
    source?: string
  }): Promise<PluginRecord>
  setPluginEnabled(id: string, enabled: boolean): Promise<PluginRecord>
  removePlugin(id: string): Promise<void>

  scanCcSwitch(path: string): Promise<CcSwitchProviderSummary[]>
  readCcSwitchProvider(path: string, id: string): Promise<CcSwitchProviderDetail>

  dispose(): void
}

export class HostCoreClient implements MetadataStore {
  readonly #rpc: RpcClient

  constructor(transport: RpcTransport, timeoutMs?: number) {
    this.#rpc = new RpcClient(transport, timeoutMs)
  }

  ping(): Promise<{ ok: boolean }> {
    return this.#rpc.request<{ ok: boolean }>('system.ping')
  }

  info(): Promise<HostInfo> {
    return this.#rpc.request<HostInfo>('system.info')
  }

  listProjects(): Promise<Project[]> {
    return this.#rpc.request<Project[]>('project.list')
  }

  addProject(path: string, name?: string): Promise<Project> {
    return this.#rpc.request<Project>('project.add', name === undefined ? { path } : { path, name })
  }

  async removeProject(id: string): Promise<void> {
    await this.#rpc.request('project.remove', { id })
  }

  listSessions(projectId?: string): Promise<Session[]> {
    return this.#rpc.request<Session[]>(
      'session.list',
      projectId === undefined ? {} : { projectId },
    )
  }

  createSession(projectId: string, title: string): Promise<Session> {
    return this.#rpc.request<Session>('session.create', { projectId, title })
  }

  renameSession(id: string, title: string): Promise<Session> {
    return this.#rpc.request<Session>('session.rename', { id, title })
  }

  async deleteSession(id: string): Promise<void> {
    await this.#rpc.request('session.delete', { id })
  }

  listSettings(): Promise<SettingsMap> {
    return this.#rpc.request<SettingsMap>('settings.list')
  }

  async putSetting(key: string, value: JsonValue): Promise<void> {
    await this.#rpc.request('settings.put', { key, value })
  }

  listPlugins(): Promise<PluginRecord[]> {
    return this.#rpc.request<PluginRecord[]>('plugin.list')
  }

  upsertPlugin(input: {
    id: string
    version: string
    enabled?: boolean
    source?: string
  }): Promise<PluginRecord> {
    const params: { [key: string]: JsonValue } = {
      id: input.id,
      version: input.version,
    }
    if (input.enabled !== undefined) params.enabled = input.enabled
    if (input.source !== undefined) params.source = input.source

    return this.#rpc.request<PluginRecord>('plugin.upsert', params)
  }

  setPluginEnabled(id: string, enabled: boolean): Promise<PluginRecord> {
    return this.#rpc.request<PluginRecord>('plugin.setEnabled', { id, enabled })
  }

  async removePlugin(id: string): Promise<void> {
    await this.#rpc.request('plugin.remove', { id })
  }

  scanCcSwitch(path: string): Promise<CcSwitchProviderSummary[]> {
    return this.#rpc.request<CcSwitchProviderSummary[]>('ccswitch.scan', { path })
  }

  readCcSwitchProvider(path: string, id: string): Promise<CcSwitchProviderDetail> {
    return this.#rpc.request<CcSwitchProviderDetail>('ccswitch.read', { path, id })
  }

  dispose(): void {
    this.#rpc.dispose()
  }
}
