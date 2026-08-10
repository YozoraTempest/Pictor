import { randomUUID } from 'node:crypto'
import { mkdir, realpath, rename, stat, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { z } from 'zod'

import {
  appSnapshotSchema,
  modelSettingsInputSchema,
  projectSchema,
  sessionRecordSchema,
  sessionSummarySchema,
  type AppSnapshot,
  type ModelSettings,
  type Project,
  type SaveSettingsRequest,
  type SessionRecord,
  type SessionSummary,
} from '../../../src/shared/contracts.js'
import { PictorError } from '../errors.js'
import { isNodeError, readJsonFile, writeJsonFile } from './atomic-json.js'
import { CredentialUnavailableError, type SecretStore } from './secret-store.js'

const stateSchema = z.object({
  schemaVersion: z.literal(1),
  projects: z.array(projectSchema),
  sessions: z.array(sessionSummarySchema),
  selectedProjectId: z.uuid().nullable(),
  selectedSessionId: z.uuid().nullable(),
  settings: modelSettingsInputSchema.nullable(),
})

type PersistedState = z.infer<typeof stateSchema>

const activeRunStatuses = new Set(['queued', 'running', 'awaiting-approval', 'stopping'])

function createEmptyState(): PersistedState {
  return {
    schemaVersion: 1,
    projects: [],
    sessions: [],
    selectedProjectId: null,
    selectedSessionId: null,
    settings: null,
  }
}

function summarizeSession(session: SessionRecord): SessionSummary {
  return sessionSummarySchema.parse({
    id: session.id,
    projectId: session.projectId,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastRunStatus: session.runs.at(-1)?.status ?? null,
  })
}

export class AppRepository {
  private readonly statePath: string
  private readonly sessionsDirectory: string
  private state: PersistedState = createEmptyState()
  private initialized = false
  private issues: AppSnapshot['issues'] = []

  constructor(
    private readonly dataDirectory: string,
    private readonly secretStore: SecretStore,
  ) {
    this.statePath = join(dataDirectory, 'state.json')
    this.sessionsDirectory = join(dataDirectory, 'sessions')
  }

  async initialize(): Promise<void> {
    await mkdir(this.sessionsDirectory, { recursive: true })
    this.state = (await readJsonFile(this.statePath, stateSchema)) ?? createEmptyState()
    this.issues = []

    let changed = await this.refreshProjectAvailability()
    const validSummaries: SessionSummary[] = []

    for (const summary of this.state.sessions) {
      try {
        const session = await this.readSession(summary.id)
        const interrupted = this.interruptActiveRuns(session)
        if (interrupted) await this.writeSession(session)
        const repairedSummary = summarizeSession(session)
        validSummaries.push(repairedSummary)
        changed ||= interrupted || JSON.stringify(repairedSummary) !== JSON.stringify(summary)
      } catch {
        await this.quarantineSession(summary.id)
        this.issues.push({
          code: 'session-corrupt',
          sessionId: summary.id,
          message: `会话“${summary.title}”的数据已损坏，已隔离且不会影响其他会话`,
        })
        changed = true
      }
    }

    this.state.sessions = validSummaries
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
      issues: this.issues,
    })
  }

  async findProjectByPath(rootPath: string): Promise<Project | null> {
    this.ensureInitialized()
    const canonicalPath = await this.canonicalDirectory(rootPath)
    return (
      this.state.projects.find(
        (project) =>
          project.rootPath.toLocaleLowerCase('en-US') === canonicalPath.toLocaleLowerCase('en-US'),
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

  async removeProject(projectId: string): Promise<void> {
    this.ensureInitialized()
    const project = this.state.projects.find((candidate) => candidate.id === projectId)
    if (!project) throw new PictorError('not-found', '项目不存在或已被移除')

    const sessionIds = this.state.sessions
      .filter((session) => session.projectId === projectId)
      .map((session) => session.id)
    await Promise.all(
      sessionIds.map((sessionId) => unlink(this.sessionPath(sessionId)).catch(() => undefined)),
    )
    this.state.projects = this.state.projects.filter((candidate) => candidate.id !== projectId)
    this.state.sessions = this.state.sessions.filter((session) => session.projectId !== projectId)
    this.repairSelection()
    await this.persistState()
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
    await this.writeSession(session)
    const summary = summarizeSession(session)
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
    return this.readSession(sessionId)
  }

  async saveSession(session: SessionRecord): Promise<SessionSummary> {
    this.ensureInitialized()
    const parsed = sessionRecordSchema.parse(session)
    const existing = this.state.sessions.find((candidate) => candidate.id === parsed.id)
    if (!existing || existing.projectId !== parsed.projectId) {
      throw new PictorError('not-found', '会话不存在或项目绑定不匹配')
    }

    await this.writeSession(parsed)
    const summary = summarizeSession(parsed)
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
    await unlink(this.sessionPath(sessionId)).catch((error) => {
      if (!isNodeError(error) || error.code !== 'ENOENT') throw error
    })
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
      baseUrl: request.baseUrl.replace(/\/+$/, ''),
      modelId: request.modelId,
      temperature: request.temperature,
      maxOutputTokens: request.maxOutputTokens,
    })

    try {
      if (request.apiKey.action === 'replace')
        await this.secretStore.setApiKey(request.apiKey.value)
      if (request.apiKey.action === 'clear') await this.secretStore.clearApiKey()
    } catch (error) {
      if (error instanceof CredentialUnavailableError) {
        throw new PictorError('credential-unavailable', error.message)
      }
      throw error
    }

    this.state.settings = settings
    await this.persistState()
    return { ...settings, hasApiKey: await this.secretStore.hasApiKey() }
  }

  async getApiKey(): Promise<string | null> {
    this.ensureInitialized()
    try {
      return await this.secretStore.getApiKey()
    } catch (error) {
      if (error instanceof CredentialUnavailableError) {
        throw new PictorError('credential-unavailable', error.message)
      }
      throw error
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized) throw new Error('AppRepository has not been initialized')
  }

  private sessionPath(sessionId: string): string {
    return join(this.sessionsDirectory, `${sessionId}.json`)
  }

  private async readSession(sessionId: string): Promise<SessionRecord> {
    const session = await readJsonFile(this.sessionPath(sessionId), sessionRecordSchema)
    if (!session) throw new Error('Session file is missing')
    return session
  }

  private async writeSession(session: SessionRecord): Promise<void> {
    await writeJsonFile(this.sessionPath(session.id), sessionRecordSchema.parse(session))
  }

  private async quarantineSession(sessionId: string): Promise<void> {
    const source = this.sessionPath(sessionId)
    const destination = join(this.sessionsDirectory, `${sessionId}.corrupt-${Date.now()}.json`)
    await rename(source, destination).catch(() => undefined)
  }

  private interruptActiveRuns(session: SessionRecord): boolean {
    let changed = false
    const now = new Date().toISOString()
    for (const run of session.runs) {
      if (activeRunStatuses.has(run.status)) {
        run.status = 'interrupted'
        run.error = '应用在运行完成前关闭，任务未自动重放'
        run.updatedAt = now
        changed = true
      }
    }
    if (changed) session.updatedAt = now
    return changed
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
