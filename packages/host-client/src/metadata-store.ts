import { RpcClient } from '@vulonlok/racp'
import type { RpcTransport } from '@vulonlok/racp'
import type {
  CcSwitchProviderDetail,
  CcSwitchProviderSummary,
  HostInfo,
  JsonValue,
  PluginRecord,
  Project,
  Section,
  Session,
  SettingsMap,
} from '@vulonlok/shared'

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
  setProjectSection(id: string, sectionId: string | null): Promise<Project>
  reorderSections(ids: string[]): Promise<Section[]>
  addProjectFolder(id: string, path: string): Promise<string[]>
  removeProjectFolder(id: string, path: string): Promise<string[]>

  listSessions(projectId?: string): Promise<Session[]>
  createSession(
    projectId: string | null,
    title: string,
    parentId?: string | null,
    kernelId?: string,
  ): Promise<Session>
  renameSession(id: string, title: string): Promise<Session>
  setSessionPinned(id: string, pinned: boolean): Promise<Session>
  setSessionArchived(id: string, archived: boolean): Promise<Session>
  archiveSessions(ids: string[]): Promise<number>
  reorderSessions(ids: string[]): Promise<number>
  setSessionProject(id: string, projectId: string | null): Promise<Session>
  setSessionSections(id: string, sectionIds: string[]): Promise<Session>
  deleteSession(id: string): Promise<void>

  listSections(): Promise<Section[]>
  createSection(name: string): Promise<Section>
  renameSection(id: string, name: string): Promise<Section>
  removeSection(id: string): Promise<void>

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

  setProjectSection(id: string, sectionId: string | null): Promise<Project> {
    return this.#rpc.request<Project>('project.setSection', { id, sectionId })
  }

  reorderSections(ids: string[]): Promise<Section[]> {
    return this.#rpc.request<Section[]>('section.reorder', { ids })
  }

  addProjectFolder(id: string, path: string): Promise<string[]> {
    return this.#rpc.request<string[]>('project.addFolder', { id, path })
  }

  removeProjectFolder(id: string, path: string): Promise<string[]> {
    return this.#rpc.request<string[]>('project.removeFolder', { id, path })
  }

  listSessions(projectId?: string): Promise<Session[]> {
    return this.#rpc.request<Session[]>(
      'session.list',
      projectId === undefined ? {} : { projectId },
    )
  }

  createSession(
    projectId: string | null,
    title: string,
    parentId: string | null = null,
    kernelId?: string,
  ): Promise<Session> {
    return this.#rpc.request<Session>('session.create', {
      projectId,
      title,
      parentId,
      ...(kernelId === undefined ? {} : { kernelId }),
    })
  }

  renameSession(id: string, title: string): Promise<Session> {
    return this.#rpc.request<Session>('session.rename', { id, title })
  }

  setSessionPinned(id: string, pinned: boolean): Promise<Session> {
    return this.#rpc.request<Session>('session.setPinned', { id, pinned })
  }

  setSessionArchived(id: string, archived: boolean): Promise<Session> {
    return this.#rpc.request<Session>('session.setArchived', { id, archived })
  }

  async reorderSessions(ids: string[]): Promise<number> {
    const result = await this.#rpc.request<{ reordered: number }>('session.reorder', { ids })
    return result.reordered
  }

  async archiveSessions(ids: string[]): Promise<number> {
    const result = await this.#rpc.request<{ archived: number }>('session.archiveMany', { ids })
    return result.archived
  }

  setSessionProject(id: string, projectId: string | null): Promise<Session> {
    return this.#rpc.request<Session>('session.setProject', { id, projectId })
  }

  setSessionSections(id: string, sectionIds: string[]): Promise<Session> {
    return this.#rpc.request<Session>('session.setSections', { id, sectionIds })
  }

  async deleteSession(id: string): Promise<void> {
    await this.#rpc.request('session.delete', { id })
  }

  listSections(): Promise<Section[]> {
    return this.#rpc.request<Section[]>('section.list')
  }

  createSection(name: string): Promise<Section> {
    return this.#rpc.request<Section>('section.create', { name })
  }

  renameSection(id: string, name: string): Promise<Section> {
    return this.#rpc.request<Section>('section.rename', { id, name })
  }

  async removeSection(id: string): Promise<void> {
    await this.#rpc.request('section.remove', { id })
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
