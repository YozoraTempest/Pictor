import { mkdir, rename, unlink } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'

import {
  sessionRecordSchema,
  sessionSummarySchema,
  type DataIssue,
  type SessionRecord,
  type SessionSummary,
} from '../../shared/domain.js'
import { createSecretRedactor } from '../../shared/secret-redaction.js'
import { isNodeError, readJsonFile, writeJsonFile } from './atomic-json.js'
import {
  migrateCredentialPersistence,
  type CredentialMigrationResult,
} from './credential-migration.js'
import type { SecretStore } from './secret-store.js'

const activeRunStatuses = new Set(['queued', 'running', 'awaiting-approval', 'stopping'])

export type CredentialMigration = (
  dataDirectory: string,
  secretValues: readonly string[],
) => Promise<CredentialMigrationResult>

export interface SessionRecoveryResult {
  summaries: SessionSummary[]
  issues: DataIssue[]
  changed: boolean
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

function isPathWithin(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate)
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

export class SessionPersistence {
  private readonly sessionsDirectory: string
  private unsafePiPaths: string[] = []
  private blockAllPiResume = false

  constructor(
    private readonly dataDirectory: string,
    private readonly secretStore: Pick<SecretStore, 'getApiKey'>,
    private readonly migrateCredentials: CredentialMigration = migrateCredentialPersistence,
  ) {
    this.sessionsDirectory = join(dataDirectory, 'sessions')
  }

  async recover(
    summaries: readonly SessionSummary[],
    previousIssues: readonly DataIssue[],
  ): Promise<SessionRecoveryResult> {
    await mkdir(this.sessionsDirectory, { recursive: true })
    this.unsafePiPaths = []
    this.blockAllPiResume = false

    const issues = [...previousIssues]
    const previousIssuesJson = JSON.stringify(issues)
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
        const interrupted = this.interruptActiveRuns(session)
        const repairedSummary = interrupted ? await this.save(session) : summarizeSession(session)
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
    const session = await readJsonFile(this.sessionPath(sessionId), sessionRecordSchema)
    if (!session) throw new Error('Session file is missing')
    const sanitized = await this.sanitize(session)
    if (JSON.stringify(sanitized) !== JSON.stringify(session)) {
      await writeJsonFile(this.sessionPath(session.id), sanitized)
    }
    return sanitized
  }

  async save(session: SessionRecord): Promise<SessionSummary> {
    const sanitized = await this.sanitize(sessionRecordSchema.parse(session))
    await writeJsonFile(this.sessionPath(sanitized.id), sanitized)
    return summarizeSession(sanitized)
  }

  async delete(sessionId: string): Promise<void> {
    await unlink(this.sessionPath(sessionId)).catch((error) => {
      if (!isNodeError(error) || error.code !== 'ENOENT') throw error
    })
  }

  async deleteMany(sessionIds: readonly string[]): Promise<void> {
    await Promise.all(
      sessionIds.map((sessionId) => unlink(this.sessionPath(sessionId)).catch(() => undefined)),
    )
  }

  getRuntimePaths(
    projectId: string,
    sessionId: string,
  ): {
    agentDirectory: string
    sessionDirectory: string
    resumeSession: boolean
  } {
    const sessionDirectory = join(this.dataDirectory, 'pi', projectId, sessionId)
    return {
      agentDirectory: join(this.dataDirectory, 'pi', 'agent'),
      sessionDirectory,
      resumeSession:
        !this.blockAllPiResume &&
        !this.unsafePiPaths.some(
          (unsafePath) =>
            isPathWithin(sessionDirectory, unsafePath) ||
            isPathWithin(unsafePath, sessionDirectory),
        ),
    }
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
