import { mkdir, readFile, readdir, rename, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

import { z } from 'zod'

import {
  sessionRecordSchema,
  sessionHistoryStateSchema,
  sessionHistoryViewSchema,
  sessionSummarySchema,
  type DataIssue,
  type SessionRecord,
  type SessionHistoryState,
  type SessionHistoryView,
  type SessionSummary,
} from '../../shared/domain.js'
import { createSecretRedactor } from '../../shared/secret-redaction.js'
import { isNodeError, readJsonFile, writeJsonFile } from './atomic-json.js'
import {
  migrateCredentialPersistence,
  type CredentialMigrationResult,
} from './credential-migration.js'
import type { SecretStore } from './secret-store.js'
import { projectPiSessionJsonl } from './pi-session-projection.js'

const activeRunStatuses = new Set(['queued', 'running', 'awaiting-approval', 'stopping'])
const sessionProjectionSchema = sessionRecordSchema.pick({
  messages: true,
  runs: true,
  usage: true,
  runtimeState: true,
})
const legacyRuntimePreferencesSchema = z.object({
  modelId: z.string().min(1).nullable().default(null),
  thinkingLevel: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).nullable(),
  activeTools: z.array(z.string().min(1)).nullable(),
  steeringMode: z.enum(['all', 'one-at-a-time']),
  followUpMode: z.enum(['all', 'one-at-a-time']),
  projectExtensionsEnabled: z.boolean().optional(),
})
const legacySessionHistoryStateSchema = z.object({
  authority: z.enum(['pi-jsonl', 'legacy-import']),
  piSessionId: z.string().min(1).nullable(),
  piSessionFile: z.string().min(1).nullable(),
  activeLeafId: z.string().min(1).nullable().optional(),
  runtimePreferences: legacyRuntimePreferencesSchema.optional(),
  legacyImport: z.object({
    status: z.enum(['not-required', 'pending', 'imported']),
    sourceFile: z.string().min(1).nullable(),
  }),
})
const persistedSessionV2Schema = z.object({
  schemaVersion: z.literal(2),
  id: sessionRecordSchema.shape.id,
  projectId: sessionRecordSchema.shape.projectId,
  title: sessionRecordSchema.shape.title,
  history: sessionHistoryStateSchema,
  projection: sessionProjectionSchema.extend({ generatedAt: z.iso.datetime() }),
  createdAt: sessionRecordSchema.shape.createdAt,
  updatedAt: sessionRecordSchema.shape.updatedAt,
})
const legacyPersistedSessionV2Schema = z.object({
  schemaVersion: z.literal(2),
  id: sessionRecordSchema.shape.id,
  projectId: sessionRecordSchema.shape.projectId,
  title: sessionRecordSchema.shape.title,
  history: legacySessionHistoryStateSchema,
  projection: sessionProjectionSchema.extend({ generatedAt: z.iso.datetime() }),
  createdAt: sessionRecordSchema.shape.createdAt,
  updatedAt: sessionRecordSchema.shape.updatedAt,
})
const persistedSessionSchema = z.union([
  persistedSessionV2Schema,
  legacyPersistedSessionV2Schema,
  sessionRecordSchema,
])
const piSessionHeaderSchema = z.object({
  type: z.literal('session'),
  id: z.string().min(1),
})

type PersistedSessionV2 = z.infer<typeof persistedSessionV2Schema>
type PersistedSession = PersistedSessionV2 | z.infer<typeof legacyPersistedSessionV2Schema>

const activeToolNameMigration: Readonly<Record<string, string | undefined>> = {
  pictor_list: 'ls',
  pictor_search: 'grep',
  pictor_read: 'read',
  pictor_write: 'write',
  pictor_edit: 'edit',
  pictor_command: 'bash',
  pictor_move: undefined,
  pictor_delete: undefined,
}

export function normalizeActiveToolNames(
  activeTools: readonly string[] | null | undefined,
): string[] | null | undefined {
  if (activeTools === null || activeTools === undefined) return activeTools
  const names = new Set<string>()
  for (const name of activeTools) {
    const migrated = Object.prototype.hasOwnProperty.call(activeToolNameMigration, name)
      ? activeToolNameMigration[name]
      : name
    if (migrated) names.add(migrated)
  }
  return [...names]
}

export type CredentialMigration = (
  dataDirectory: string,
  secretValues: readonly string[],
) => Promise<CredentialMigrationResult>

export interface SessionRecoveryResult {
  summaries: SessionSummary[]
  issues: DataIssue[]
  changed: boolean
}

function summarizeSession(
  session: SessionRecord,
  authority?: SessionHistoryState['authority'],
): SessionSummary {
  return sessionSummarySchema.parse({
    id: session.id,
    projectId: session.projectId,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastRunStatus: session.runs.at(-1)?.status ?? null,
    ...(authority ? { historyAuthority: authority } : {}),
  })
}

function isPathWithin(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate)
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

export class SessionPersistence {
  private readonly sessionsDirectory: string
  private readonly legacyImportsDirectory: string
  private readonly histories = new Map<string, SessionHistoryState>()
  private unsafePiPaths: string[] = []
  private blockAllPiResume = false

  constructor(
    private readonly dataDirectory: string,
    private readonly secretStore: Pick<SecretStore, 'getApiKey'>,
    private readonly migrateCredentials: CredentialMigration = migrateCredentialPersistence,
  ) {
    this.sessionsDirectory = join(dataDirectory, 'sessions')
    this.legacyImportsDirectory = join(this.sessionsDirectory, 'legacy-imports')
  }

  async recover(
    summaries: readonly SessionSummary[],
    previousIssues: readonly DataIssue[],
  ): Promise<SessionRecoveryResult> {
    await Promise.all([
      mkdir(this.sessionsDirectory, { recursive: true }),
      mkdir(this.legacyImportsDirectory, { recursive: true }),
    ])
    this.histories.clear()
    this.unsafePiPaths = []
    this.blockAllPiResume = false

    const previousIssuesJson = JSON.stringify(previousIssues)
    const issues = previousIssues.filter((issue) => issue.code !== 'legacy-session-import-pending')
    const migrationSecrets = await this.getMigrationSecretValues()
    const previousMigrationIssue = issues.some(
      (issue) => issue.code === 'credential-migration-failed',
    )

    if (migrationSecrets.failed) {
      this.blockAllPiResume = true
      this.addMigrationIssue(issues)
    } else if (migrationSecrets.values.length > 0) {
      const migration = await this.migrateCredentials(this.dataDirectory, migrationSecrets.values)
      const retainedIssues = issues.filter((issue) => issue.code !== 'credential-migration-failed')
      issues.splice(0, issues.length, ...retainedIssues)
      if (migration.failures.length > 0) {
        this.unsafePiPaths = migration.failures
          .filter((failure) => failure.scope === 'pi')
          .map((failure) => failure.path)
        this.addMigrationIssue(issues)
      }
    } else if (previousMigrationIssue) {
      this.blockAllPiResume = true
    }

    let changed = previousIssuesJson !== JSON.stringify(issues)
    const validSummaries: SessionSummary[] = []

    for (const summary of summaries) {
      try {
        const session = await this.read(summary.id)
        if (
          this.getHistory(session.id).authority === 'legacy-import' &&
          !issues.some(
            (issue) =>
              issue.code === 'legacy-session-import-pending' && issue.sessionId === session.id,
          )
        ) {
          issues.push({
            code: 'legacy-session-import-pending',
            sessionId: session.id,
            message: `会话“${session.title}”保留为旧版只读历史，需要显式导入后才能继续运行`,
          })
        }
        const interrupted = this.interruptActiveRuns(session)
        const repairedSummary = interrupted
          ? await this.save(session)
          : summarizeSession(session, this.getHistory(session.id).authority)
        validSummaries.push(repairedSummary)
        changed ||= interrupted || JSON.stringify(repairedSummary) !== JSON.stringify(summary)
      } catch {
        await this.quarantine(summary.id)
        issues.push({
          code: 'session-corrupt',
          sessionId: summary.id,
          message: `会话“${summary.title}”的数据已损坏，已隔离且不会影响其他会话`,
        })
        changed = true
      }
    }

    return { summaries: validSummaries, issues, changed }
  }

  async read(sessionId: string): Promise<SessionRecord> {
    const persisted = await readJsonFile(this.sessionPath(sessionId), persistedSessionSchema)
    if (!persisted) throw new Error('Session file is missing')
    if (persisted.schemaVersion === 1) return this.migrateV1(persisted)

    const history = this.normalizeHistory(persisted.id, persisted.projectId, persisted.history)
    this.histories.set(persisted.id, history)
    const session = this.toProjection(persisted)
    const sanitized = await this.sanitize(session)
    if (
      JSON.stringify(sanitized) !== JSON.stringify(session) ||
      JSON.stringify(history) !== JSON.stringify(persisted.history)
    ) {
      await this.writeV2(sanitized, history)
    }
    return sanitized
  }

  async save(session: SessionRecord): Promise<SessionSummary> {
    const sanitized = await this.sanitize(sessionRecordSchema.parse(session))
    const history = this.normalizeHistory(
      sanitized.id,
      sanitized.projectId,
      this.histories.get(sanitized.id) ?? this.createUnboundHistory(),
    )
    this.histories.set(sanitized.id, history)
    await this.writeV2(sanitized, history)
    return summarizeSession(sanitized, history.authority)
  }

  getHistory(sessionId: string): SessionHistoryState {
    return this.histories.get(sessionId) ?? this.createUnboundHistory()
  }

  async bindPiSession(
    session: SessionRecord,
    identity: { id: string; path?: string; file?: string },
  ): Promise<void> {
    const piSessionPath = this.resolvePiSessionPath(session.projectId, session.id, identity)
    const sanitized = await this.sanitize(sessionRecordSchema.parse(session))
    const existing = this.histories.get(session.id)
    const history = sessionHistoryStateSchema.parse({
      authority: 'pi-jsonl',
      piSessionId: identity.id,
      piSessionPath,
      ...(existing?.activeLeafId !== undefined ? { activeLeafId: existing.activeLeafId } : {}),
      ...(existing?.runtimePreferences ? { runtimePreferences: existing.runtimePreferences } : {}),
      legacyImport: { status: 'not-required', sourceFile: null },
    })
    this.histories.set(session.id, history)
    await this.writeV2(sanitized, history)
  }

  async rebuildProjection(sessionId: string): Promise<SessionRecord> {
    const session = await this.read(sessionId)
    const history = this.getHistory(sessionId)
    const transcriptPath = this.transcriptPath(session, history)
    if (!transcriptPath) throw new Error('Pi Session identity is not bound')
    const projection = projectPiSessionJsonl(
      await readFile(transcriptPath, 'utf8'),
      null,
      history.activeLeafId,
    )
    session.messages = projection.messages
    session.runs = projection.runs
    session.usage = projection.usage
    session.runtimeState = projection.runtimeState
    session.updatedAt =
      [
        ...session.messages.map((message) => message.updatedAt),
        ...session.runs.map((run) => run.updatedAt),
      ]
        .toSorted()
        .at(-1) ?? session.updatedAt
    await this.writeV2(await this.sanitize(session), history)
    return session
  }

  async inspectHistory(
    sessionId: string,
    selectedEntryId: string | null,
  ): Promise<SessionHistoryView> {
    const session = await this.read(sessionId)
    const history = this.getHistory(sessionId)
    const transcriptPath = this.transcriptPath(session, history)
    if (!transcriptPath) return sessionHistoryViewSchema.parse({ session, tree: null })

    const projection = projectPiSessionJsonl(
      await readFile(transcriptPath, 'utf8'),
      selectedEntryId,
      history.activeLeafId,
    )
    const redactor = createSecretRedactor(await this.getKnownSecretValues())
    const inspectedSession = sessionRecordSchema.parse(
      redactor.redactSession({
        ...session,
        messages: projection.messages,
        runs: projection.runs,
        usage: projection.usage,
        runtimeState: projection.runtimeState,
      }),
    )
    return sessionHistoryViewSchema.parse({
      session: inspectedSession,
      tree: {
        ...projection.tree,
        nodes: projection.tree.nodes.map((node) => ({
          ...node,
          label: redactor.redactText(node.label),
        })),
      },
    })
  }

  async delete(sessionId: string): Promise<void> {
    const legacySource = this.histories.get(sessionId)?.legacyImport.sourceFile
    await unlink(this.sessionPath(sessionId)).catch((error) => {
      if (!isNodeError(error) || error.code !== 'ENOENT') throw error
    })
    if (legacySource) {
      const legacyPath = join(this.sessionsDirectory, legacySource)
      if (isPathWithin(this.legacyImportsDirectory, legacyPath)) {
        await unlink(legacyPath).catch(() => undefined)
      }
    }
    this.histories.delete(sessionId)
  }

  async deleteMany(sessionIds: readonly string[]): Promise<void> {
    await Promise.all(sessionIds.map((sessionId) => this.delete(sessionId)))
  }

  getRuntimePaths(
    projectId: string,
    sessionId: string,
  ): {
    agentDirectory: string
    sessionDirectory: string
    resumeSession: boolean
    piSessionPath: string | null
    activeLeafId?: string | null
    runtimePreferences?: SessionHistoryState['runtimePreferences']
  } {
    const history = this.getHistory(sessionId)
    const sessionDirectory = history.piSessionPath
      ? dirname(history.piSessionPath)
      : join(this.dataDirectory, 'pi', 'sessions', projectId)
    return {
      agentDirectory: join(this.dataDirectory, 'pi', 'agent'),
      sessionDirectory,
      piSessionPath: history.piSessionPath,
      ...(history.activeLeafId !== undefined ? { activeLeafId: history.activeLeafId } : {}),
      ...(history.runtimePreferences ? { runtimePreferences: history.runtimePreferences } : {}),
      resumeSession:
        history.authority === 'pi-jsonl' &&
        history.piSessionPath !== null &&
        !this.blockAllPiResume &&
        !this.unsafePiPaths.some(
          (unsafePath) =>
            isPathWithin(sessionDirectory, unsafePath) ||
            isPathWithin(unsafePath, sessionDirectory),
        ),
    }
  }

  async setActiveLeaf(sessionId: string, activeLeafId: string | null): Promise<void> {
    const session = await this.read(sessionId)
    const history = this.getHistory(sessionId)
    if (history.authority !== 'pi-jsonl' || !history.piSessionPath) {
      throw new Error('Pi Session identity is not bound')
    }
    const updated = sessionHistoryStateSchema.parse({ ...history, activeLeafId })
    this.histories.set(sessionId, updated)
    await this.writeV2(session, updated)
  }

  async setRuntimePreferences(
    sessionId: string,
    runtimePreferences: NonNullable<SessionHistoryState['runtimePreferences']>,
  ): Promise<void> {
    const session = await this.read(sessionId)
    const history = this.getHistory(sessionId)
    if (history.authority !== 'pi-jsonl' || !history.piSessionPath) {
      throw new Error('Pi Session identity is not bound')
    }
    const updated = sessionHistoryStateSchema.parse({
      ...history,
      runtimePreferences: {
        ...runtimePreferences,
        activeTools: normalizeActiveToolNames(runtimePreferences.activeTools),
      },
    })
    this.histories.set(sessionId, updated)
    await this.writeV2(session, updated)
  }

  private async migrateV1(session: SessionRecord): Promise<SessionRecord> {
    const sanitized = await this.sanitize(session)
    const piIdentity = await this.discoverPiIdentity(sanitized.projectId, sanitized.id)
    const hasLegacyHistory = sanitized.messages.length > 0 || sanitized.runs.length > 0
    let history: SessionHistoryState

    if (!piIdentity && hasLegacyHistory) {
      const sourceFile = `legacy-imports/${sanitized.id}-schema-v1.json`
      await writeJsonFile(join(this.sessionsDirectory, sourceFile), sanitized)
      history = sessionHistoryStateSchema.parse({
        authority: 'legacy-import',
        piSessionId: null,
        piSessionPath: null,
        legacyImport: { status: 'pending', sourceFile },
      })
    } else {
      history = sessionHistoryStateSchema.parse({
        authority: 'pi-jsonl',
        piSessionId: piIdentity?.id ?? null,
        piSessionPath: piIdentity?.path ?? null,
        legacyImport: { status: 'not-required', sourceFile: null },
      })
    }

    this.histories.set(sanitized.id, history)
    await this.writeV2(sanitized, history)
    return sanitized
  }

  private async discoverPiIdentity(
    projectId: string,
    sessionId: string,
  ): Promise<{ id: string; path: string } | null> {
    const directory = join(this.dataDirectory, 'pi', projectId, sessionId)
    let files: string[]
    try {
      files = (await readdir(directory, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
        .map((entry) => entry.name)
        .toSorted()
        .toReversed()
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return null
      throw error
    }

    for (const file of files) {
      try {
        const firstLine = (await readFile(join(directory, file), 'utf8')).split('\n', 1)[0]
        if (!firstLine) continue
        const header = piSessionHeaderSchema.safeParse(JSON.parse(firstLine))
        if (header.success) return { id: header.data.id, path: resolve(directory, file) }
      } catch {
        continue
      }
    }
    return null
  }

  private async writeV2(session: SessionRecord, history: SessionHistoryState): Promise<void> {
    const persisted = persistedSessionV2Schema.parse({
      schemaVersion: 2,
      id: session.id,
      projectId: session.projectId,
      title: session.title,
      history,
      projection: {
        messages: session.messages,
        runs: session.runs,
        usage: session.usage ?? null,
        runtimeState: session.runtimeState,
        generatedAt: new Date().toISOString(),
      },
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    })
    await writeJsonFile(this.sessionPath(session.id), persisted)
  }

  private normalizeHistory(
    sessionId: string,
    projectId: string,
    history: SessionHistoryState | z.infer<typeof legacySessionHistoryStateSchema>,
  ): SessionHistoryState {
    const piSessionPath =
      'piSessionPath' in history
        ? history.piSessionPath
        : history.piSessionFile
          ? resolve(this.dataDirectory, 'pi', projectId, sessionId, history.piSessionFile)
          : null
    if (piSessionPath !== null && !isAbsolute(piSessionPath)) {
      throw new Error('Pi Session path must be absolute')
    }
    const runtimePreferences = history.runtimePreferences
      ? {
          ...history.runtimePreferences,
          activeTools: normalizeActiveToolNames(history.runtimePreferences.activeTools) ?? null,
        }
      : undefined
    return sessionHistoryStateSchema.parse({
      authority: history.authority,
      piSessionId: history.piSessionId,
      piSessionPath: piSessionPath === null ? null : resolve(piSessionPath),
      ...(history.activeLeafId !== undefined ? { activeLeafId: history.activeLeafId } : {}),
      ...(runtimePreferences ? { runtimePreferences } : {}),
      legacyImport: history.legacyImport,
    })
  }

  private resolvePiSessionPath(
    projectId: string,
    sessionId: string,
    identity: { id: string; path?: string; file?: string },
  ): string {
    if (identity.path) {
      if (!isAbsolute(identity.path)) throw new Error('Pi Session path must be absolute')
      return resolve(identity.path)
    }
    if (!identity.file || identity.file !== basename(identity.file)) {
      throw new Error('Pi Session identity requires an absolute path')
    }
    // This branch only reads the pre-path schema and converts it immediately.
    return resolve(this.dataDirectory, 'pi', projectId, sessionId, identity.file)
  }

  private toProjection(session: PersistedSession): SessionRecord {
    return sessionRecordSchema.parse({
      schemaVersion: 1,
      id: session.id,
      projectId: session.projectId,
      title: session.title,
      messages: session.projection.messages,
      runs: session.projection.runs,
      usage: session.projection.usage ?? null,
      runtimeState: session.projection.runtimeState,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    })
  }

  private createUnboundHistory(): SessionHistoryState {
    return {
      authority: 'pi-jsonl',
      piSessionId: null,
      piSessionPath: null,
      legacyImport: { status: 'not-required', sourceFile: null },
    }
  }

  private transcriptPath(session: SessionRecord, history: SessionHistoryState): string | null {
    if (history.authority !== 'pi-jsonl' || !history.piSessionPath) {
      return null
    }
    return isAbsolute(history.piSessionPath) ? history.piSessionPath : null
  }

  private sessionPath(sessionId: string): string {
    return join(this.sessionsDirectory, `${sessionId}.json`)
  }

  private async sanitize(session: SessionRecord): Promise<SessionRecord> {
    const redactor = createSecretRedactor(await this.getKnownSecretValues())
    return sessionRecordSchema.parse(redactor.redactSession(session))
  }

  private async getKnownSecretValues(): Promise<string[]> {
    try {
      const apiKey = await this.secretStore.getApiKey()
      return apiKey ? [apiKey] : []
    } catch {
      return []
    }
  }

  private async getMigrationSecretValues(): Promise<{ values: string[]; failed: boolean }> {
    try {
      const apiKey = await this.secretStore.getApiKey()
      return { values: apiKey ? [apiKey] : [], failed: false }
    } catch {
      return { values: [], failed: true }
    }
  }

  private addMigrationIssue(issues: DataIssue[]): void {
    if (issues.some((issue) => issue.code === 'credential-migration-failed')) return
    issues.push({
      code: 'credential-migration-failed',
      sessionId: null,
      message:
        '部分历史会话的凭据清理未完成。为防止泄露，相关 Pi 会话不会恢复；请检查本地数据目录权限并重启 Pictor 后重试。',
    })
  }

  private async quarantine(sessionId: string): Promise<void> {
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
}
