import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { z } from 'zod'

import { appSnapshotSchema, type AppSnapshot } from '../../shared/desktop-bridge.js'
import {
  dataIssueSchema,
  projectSchema,
  sessionRecordSchema,
  sessionSummarySchema,
  type Project,
  type SessionHistoryView,
  type SessionHistoryState,
  type SessionRecord,
  type SessionSummary,
} from '../../shared/domain.js'
import { PictorError } from '../../shared/errors.js'
import { pathsReferToSameLocation } from '../../shared/path-identity.js'
import {
  modelSettingsInputSchema,
  type ModelSettings,
  type SaveSettingsRequest,
} from '../../shared/model.js'
import { isNodeError, readJsonFile, writeJsonFile } from './atomic-json.js'
import type { SecretStore } from './secret-store.js'
import { SessionPersistence, type CredentialMigration } from './session-persistence.js'

const PATH_PLATFORM = process.platform === 'win32' ? 'win32' : 'linux'

const stateSchema = z.object({
  schemaVersion: z.literal(1),
  projects: z.array(projectSchema),
  sessions: z.array(sessionSummarySchema),
  selectedProjectId: z.uuid().nullable(),
  selectedSessionId: z.uuid().nullable(),
  settings: modelSettingsInputSchema.nullable(),
  issues: z.array(dataIssueSchema).default([]),
})

type PersistedState = z.infer<typeof stateSchema>

function createEmptyState(): PersistedState {
  return {
    schemaVersion: 1,
    projects: [],
    sessions: [],
    selectedProjectId: null,
    selectedSessionId: null,
    settings: null,
    issues: [],
  }
}

export class AppRepository {
  private readonly statePath: string
  private readonly sessionPersistence: SessionPersistence
  private state: PersistedState = createEmptyState()
  private initialized = false

  constructor(
    private readonly dataDirectory: string,
    private readonly secretStore: SecretStore,
    migrateCredentials?: CredentialMigration,
  ) {
    this.statePath = join(dataDirectory, 'state.json')
    this.sessionPersistence = new SessionPersistence(dataDirectory, secretStore, migrateCredentials)
  }

  async initialize(): Promise<void> {
    this.state = (await readJsonFile(this.statePath, stateSchema)) ?? createEmptyState()
    const recovery = await this.sessionPersistence.recover(this.state.sessions, this.state.issues)
    const projectAvailabilityChanged = await this.refreshProjectAvailability()
    const changed = recovery.changed || projectAvailabilityChanged
    this.state.sessions = recovery.summaries
    this.state.issues = recovery.issues
    this.repairSelection()
    this.initialized = true
    if (changed) await this.persistState()
  }

  async getSnapshot(): Promise<AppSnapshot> {
    this.ensureInitialized()
    if (await this.refreshProjectAvailability()) await this.persistState()

    const settings = await this.getSettings()
    return appSnapshotSchema.parse({
      projects: this.state.projects,
      sessions: this.state.sessions,
      selectedProjectId: this.state.selectedProjectId,
      selectedSessionId: this.state.selectedSessionId,
      settings,
      issues: this.state.issues,
    })
  }

  async findProjectByPath(rootPath: string): Promise<Project | null> {
    this.ensureInitialized()
    const canonicalPath = await this.canonicalDirectory(rootPath)
    return (
      this.state.projects.find((project) =>
        pathsReferToSameLocation(project.rootPath, canonicalPath, PATH_PLATFORM),
      ) ?? null
    )
  }

  async registerProject(rootPath: string): Promise<Project> {
    this.ensureInitialized()
    const canonicalPath = await this.canonicalDirectory(rootPath)
    const existing = await this.findProjectByPath(canonicalPath)

    if (existing) {
      this.state.selectedProjectId = existing.id
      this.state.selectedSessionId = null
      await this.persistState()
      return existing
    }

    const now = new Date().toISOString()
    const project = projectSchema.parse({
      id: randomUUID(),
      name: basename(canonicalPath),
      rootPath: canonicalPath,
      trustedAt: now,
      availability: 'available',
      createdAt: now,
      updatedAt: now,
    })
    this.state.projects.push(project)
    this.state.selectedProjectId = project.id
    this.state.selectedSessionId = null
    await this.persistState()
    return project
  }

  async relinkProject(projectId: string, rootPath: string): Promise<Project> {
    this.ensureInitialized()
    const project = this.getProject(projectId)
    const canonicalPath = await this.canonicalDirectory(rootPath)
    const conflictingProject = this.state.projects.find(
      (candidate) =>
        candidate.id !== projectId &&
        pathsReferToSameLocation(candidate.rootPath, canonicalPath, PATH_PLATFORM),
    )
    if (conflictingProject) {
      throw new PictorError('invalid-input', '该目录已经关联到另一个项目')
    }

    project.name = basename(canonicalPath)
    project.rootPath = canonicalPath
    project.availability = 'available'
    project.trustedAt = new Date().toISOString()
    project.updatedAt = project.trustedAt
    this.state.selectedProjectId = project.id
    this.state.selectedSessionId =
      this.state.sessions.find((session) => session.projectId === project.id)?.id ?? null
    await this.persistState()
    return project
  }

  async selectContext(projectId: string | null, sessionId: string | null): Promise<void> {
    this.ensureInitialized()
    if (projectId === null) {
      if (sessionId !== null) throw new PictorError('invalid-input', '未选择项目时不能选择会话')
      this.state.selectedProjectId = null
      this.state.selectedSessionId = null
      await this.persistState()
      return
    }

    this.getProject(projectId)
    if (sessionId !== null) {
      const session = this.state.sessions.find((candidate) => candidate.id === sessionId)
      if (!session || session.projectId !== projectId) {
        throw new PictorError('invalid-input', '会话不属于所选项目')
      }
    }
    this.state.selectedProjectId = projectId
    this.state.selectedSessionId = sessionId
    await this.persistState()
  }

  async removeProject(projectId: string): Promise<void> {
    this.ensureInitialized()
    const project = this.state.projects.find((candidate) => candidate.id === projectId)
    if (!project) throw new PictorError('not-found', '项目不存在或已被移除')

    const sessionIds = this.state.sessions
      .filter((session) => session.projectId === projectId)
      .map((session) => session.id)
    await this.sessionPersistence.deleteMany(sessionIds)
    this.state.projects = this.state.projects.filter((candidate) => candidate.id !== projectId)
    this.state.sessions = this.state.sessions.filter((session) => session.projectId !== projectId)
    this.repairSelection()
    await this.persistState()
  }

  getProject(projectId: string): Project {
    this.ensureInitialized()
    const project = this.state.projects.find((candidate) => candidate.id === projectId)
    if (!project) throw new PictorError('not-found', '项目不存在或已被移除')
    return project
  }

  getRuntimePaths(
    projectId: string,
    sessionId: string,
  ): {
    agentDirectory: string
    sessionDirectory: string
    resumeSession: boolean
    activeLeafId: string | null
  } {
    this.ensureInitialized()
    return this.sessionPersistence.getRuntimePaths(projectId, sessionId)
  }

  getSessionHistory(sessionId: string): SessionHistoryState {
    this.ensureInitialized()
    if (!this.state.sessions.some((session) => session.id === sessionId)) {
      throw new PictorError('not-found', '会话不存在或已被删除')
    }
    return this.sessionPersistence.getHistory(sessionId)
  }

  async bindPiSession(sessionId: string, identity: { id: string; file: string }): Promise<void> {
    const session = await this.getSession(sessionId)
    await this.sessionPersistence.bindPiSession(session, identity)
  }

  async setPiSessionActiveLeaf(sessionId: string, activeLeafId: string | null): Promise<void> {
    this.ensureInitialized()
    if (!this.state.sessions.some((session) => session.id === sessionId)) {
      throw new PictorError('not-found', '会话不存在或已被删除')
    }
    await this.sessionPersistence.setActiveLeaf(sessionId, activeLeafId)
  }

  async rebuildSessionProjection(sessionId: string): Promise<SessionRecord> {
    const session = await this.sessionPersistence.rebuildProjection(sessionId)
    await this.saveSession(session)
    return session
  }

  async createSession(projectId: string): Promise<SessionSummary> {
    this.ensureInitialized()
    const project = this.state.projects.find((candidate) => candidate.id === projectId)
    if (!project) throw new PictorError('not-found', '项目不存在或已被移除')
    await this.refreshProject(project)
    if (project.availability !== 'available') {
      throw new PictorError('project-unavailable', '项目目录当前不可用，请重新关联或移除项目')
    }

    const now = new Date().toISOString()
    const session = sessionRecordSchema.parse({
      schemaVersion: 1,
      id: randomUUID(),
      projectId,
      title: '新建会话',
      messages: [],
      runs: [],
      createdAt: now,
      updatedAt: now,
    })
    const summary = await this.sessionPersistence.save(session)
    this.state.sessions.push(summary)
    this.state.selectedProjectId = projectId
    this.state.selectedSessionId = session.id
    await this.persistState()
    return summary
  }

  async getSession(sessionId: string): Promise<SessionRecord> {
    this.ensureInitialized()
    if (!this.state.sessions.some((session) => session.id === sessionId)) {
      throw new PictorError('not-found', '会话不存在或已被删除')
    }
    return this.sessionPersistence.read(sessionId)
  }

  async inspectSessionHistory(
    sessionId: string,
    selectedEntryId: string | null,
  ): Promise<SessionHistoryView> {
    this.ensureInitialized()
    if (!this.state.sessions.some((session) => session.id === sessionId)) {
      throw new PictorError('not-found', '会话不存在或已被删除')
    }
    return this.sessionPersistence.inspectHistory(sessionId, selectedEntryId)
  }

  async createDerivedSession(
    sourceSessionId: string,
    targetSessionId: string,
    kind: 'fork' | 'clone',
    identity: { id: string; file: string },
  ): Promise<SessionSummary> {
    this.ensureInitialized()
    if (this.state.sessions.some((session) => session.id === targetSessionId)) {
      throw new PictorError('invalid-input', '目标 Session 已存在')
    }
    const source = await this.getSession(sourceSessionId)
    const now = new Date().toISOString()
    const target = sessionRecordSchema.parse({
      schemaVersion: 1,
      id: targetSessionId,
      projectId: source.projectId,
      title: `${source.title} (${kind === 'clone' ? 'Clone' : 'Fork'})`.slice(0, 120),
      messages: [],
      runs: [],
      createdAt: now,
      updatedAt: now,
    })
    return this.commitPiSession(target, identity)
  }

  async createImportedSession(
    projectId: string,
    targetSessionId: string,
    title: string,
    identity: { id: string; file: string },
  ): Promise<SessionSummary> {
    this.ensureInitialized()
    this.getProject(projectId)
    if (this.state.sessions.some((session) => session.id === targetSessionId)) {
      throw new PictorError('invalid-input', '目标 Session 已存在')
    }
    const now = new Date().toISOString()
    const target = sessionRecordSchema.parse({
      schemaVersion: 1,
      id: targetSessionId,
      projectId,
      title,
      messages: [],
      runs: [],
      createdAt: now,
      updatedAt: now,
    })
    return this.commitPiSession(target, identity)
  }

  private async commitPiSession(
    target: SessionRecord,
    identity: { id: string; file: string },
  ): Promise<SessionSummary> {
    const now = target.createdAt
    await this.sessionPersistence.bindPiSession(target, identity)
    const rebuilt = await this.sessionPersistence.rebuildProjection(target.id)
    rebuilt.createdAt = now
    rebuilt.updatedAt = now
    const summary = await this.sessionPersistence.save(rebuilt)
    this.state.sessions.push(summary)
    this.state.selectedProjectId = target.projectId
    this.state.selectedSessionId = target.id
    await this.persistState()
    return summary
  }

  async saveSession(session: SessionRecord): Promise<SessionSummary> {
    this.ensureInitialized()
    const parsed = sessionRecordSchema.parse(session)
    const existing = this.state.sessions.find((candidate) => candidate.id === parsed.id)
    if (!existing || existing.projectId !== parsed.projectId) {
      throw new PictorError('not-found', '会话不存在或项目绑定不匹配')
    }

    const summary = await this.sessionPersistence.save(parsed)
    this.state.sessions = this.state.sessions.map((candidate) =>
      candidate.id === summary.id ? summary : candidate,
    )
    await this.persistState()
    return summary
  }

  async renameSession(sessionId: string, title: string): Promise<SessionSummary> {
    const session = await this.getSession(sessionId)
    session.title = title
    session.updatedAt = new Date().toISOString()
    return this.saveSession(session)
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.ensureInitialized()
    if (!this.state.sessions.some((session) => session.id === sessionId)) {
      throw new PictorError('not-found', '会话不存在或已被删除')
    }
    await this.sessionPersistence.delete(sessionId)
    this.state.sessions = this.state.sessions.filter((session) => session.id !== sessionId)
    this.repairSelection()
    await this.persistState()
  }

  async getSettings(): Promise<ModelSettings | null> {
    this.ensureInitialized()
    if (!this.state.settings) return null
    return { ...this.state.settings, hasApiKey: await this.secretStore.hasApiKey() }
  }

  async saveSettings(request: SaveSettingsRequest): Promise<ModelSettings> {
    this.ensureInitialized()
    const settings = modelSettingsInputSchema.parse({
      apiProtocol: request.apiProtocol,
      baseUrl: request.baseUrl.replace(/\/+$/, ''),
      modelId: request.modelId,
      reasoningEffort: request.reasoningEffort,
      temperature: request.temperature,
      maxOutputTokens: request.maxOutputTokens,
    })

    if (request.apiKey.action === 'replace') await this.secretStore.setApiKey(request.apiKey.value)
    if (request.apiKey.action === 'clear') await this.secretStore.clearApiKey()

    this.state.settings = settings
    await this.persistState()
    return { ...settings, hasApiKey: await this.secretStore.hasApiKey() }
  }

  async getApiKey(): Promise<string | null> {
    this.ensureInitialized()
    return this.secretStore.getApiKey()
  }

  private ensureInitialized(): void {
    if (!this.initialized) throw new Error('AppRepository has not been initialized')
  }

  private async canonicalDirectory(rootPath: string): Promise<string> {
    try {
      const canonicalPath = await realpath(rootPath)
      const details = await stat(canonicalPath)
      if (!details.isDirectory()) throw new PictorError('invalid-input', '所选路径不是目录')
      return canonicalPath
    } catch (error) {
      if (error instanceof PictorError) throw error
      throw new PictorError('project-unavailable', '无法访问所选项目目录')
    }
  }

  private async refreshProjectAvailability(): Promise<boolean> {
    const results = await Promise.all(
      this.state.projects.map((project) => this.refreshProject(project)),
    )
    return results.some(Boolean)
  }

  private async refreshProject(project: Project): Promise<boolean> {
    const previous = project.availability
    try {
      const details = await stat(project.rootPath)
      project.availability = details.isDirectory() ? 'available' : 'missing'
    } catch (error) {
      project.availability =
        isNodeError(error) && error.code === 'ENOENT' ? 'missing' : 'inaccessible'
    }
    if (project.availability !== previous) project.updatedAt = new Date().toISOString()
    return project.availability !== previous
  }

  private repairSelection(): void {
    if (!this.state.projects.some((project) => project.id === this.state.selectedProjectId)) {
      this.state.selectedProjectId = this.state.projects[0]?.id ?? null
    }
    const selectedSession = this.state.sessions.find(
      (session) => session.id === this.state.selectedSessionId,
    )
    if (!selectedSession || selectedSession.projectId !== this.state.selectedProjectId) {
      this.state.selectedSessionId =
        this.state.sessions.find((session) => session.projectId === this.state.selectedProjectId)
          ?.id ?? null
    }
  }

  private async persistState(): Promise<void> {
    try {
      await writeJsonFile(this.statePath, stateSchema.parse(this.state))
    } catch (error) {
      throw new PictorError(
        'persistence-failed',
        error instanceof Error
          ? `无法保存 Pictor 本地数据：${error.message}`
          : '无法保存 Pictor 本地数据',
      )
    }
  }
}
