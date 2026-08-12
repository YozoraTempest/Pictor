import { z } from 'zod'

import {
  dataIssueSchema,
  idSchema,
  projectSchema,
  sessionRecordSchema,
  sessionSummarySchema,
  type Project,
  type SessionRecord,
  type SessionSummary,
} from './domain.js'
import { ipcErrorSchema, type IpcError } from './errors.js'
import {
  connectionTestResultSchema,
  listModelsRequestSchema,
  modelCatalogResultSchema,
  modelSettingsSchema,
  saveSettingsRequestSchema,
  testSettingsRequestSchema,
  type ConnectionTestResult,
  type ListModelsRequest,
  type ModelCatalogResult,
  type ModelSettings,
  type SaveSettingsRequest,
  type TestSettingsRequest,
} from './model.js'
import { runtimeEventSchema, type RuntimeEvent } from './runtime-protocol.js'

export const appInfoSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  platform: z.literal('win32'),
})

export const updateCheckResultSchema = z.object({
  currentVersion: z.string().min(1),
  latestVersion: z.string().min(1),
  updateAvailable: z.boolean(),
  installerAvailable: z.boolean(),
  publishedAt: z.iso.datetime().nullable(),
})

export const appSnapshotSchema = z.object({
  projects: z.array(projectSchema),
  sessions: z.array(sessionSummarySchema),
  selectedProjectId: idSchema.nullable(),
  selectedSessionId: idSchema.nullable(),
  settings: modelSettingsSchema.nullable(),
  issues: z.array(dataIssueSchema),
})

export const projectCandidateSchema = z.object({
  name: z.string().min(1),
  rootPath: z.string().min(1),
  existingProjectId: idSchema.nullable(),
})

export const registerProjectRequestSchema = z.object({
  rootPath: z.string().min(1),
  trusted: z.literal(true),
})

export const relinkProjectRequestSchema = registerProjectRequestSchema.extend({
  projectId: idSchema,
})

export const projectIdRequestSchema = z.object({ projectId: idSchema })
export const sessionIdRequestSchema = z.object({ sessionId: idSchema })
export const createSessionRequestSchema = z.object({ projectId: idSchema })
export const selectContextRequestSchema = z.object({
  projectId: idSchema.nullable(),
  sessionId: idSchema.nullable(),
})
export const renameSessionRequestSchema = z.object({
  sessionId: idSchema,
  title: z.string().trim().min(1).max(120),
})
export const startRunRequestSchema = z.object({
  sessionId: idSchema,
  prompt: z.string().trim().min(1).max(200_000),
})
export const runIdRequestSchema = z.object({ runId: idSchema })
export const approvalResolutionRequestSchema = z.object({
  runId: idSchema,
  callId: z.string().min(1),
})

export function ipcResultSchema<T extends z.ZodType>(valueSchema: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value: valueSchema }),
    z.object({ ok: z.literal(false), error: ipcErrorSchema }),
  ])
}

export const appSnapshotResultSchema = ipcResultSchema(appSnapshotSchema)
export const projectCandidateResultSchema = ipcResultSchema(projectCandidateSchema.nullable())
export const projectResultSchema = ipcResultSchema(projectSchema)
export const sessionSummaryResultSchema = ipcResultSchema(sessionSummarySchema)
export const sessionRecordResultSchema = ipcResultSchema(sessionRecordSchema)
export const settingsResultSchema = ipcResultSchema(modelSettingsSchema.nullable())
export const savedSettingsResultSchema = ipcResultSchema(modelSettingsSchema)
export const connectionTestIpcResultSchema = ipcResultSchema(connectionTestResultSchema)
export const modelCatalogIpcResultSchema = ipcResultSchema(modelCatalogResultSchema)
export const updateCheckIpcResultSchema = ipcResultSchema(updateCheckResultSchema)
export const voidResultSchema = ipcResultSchema(z.null())
export const startRunResultSchema = ipcResultSchema(z.object({ runId: idSchema }))

export type AppInfo = z.infer<typeof appInfoSchema>
export type UpdateCheckResult = z.infer<typeof updateCheckResultSchema>
export type AppSnapshot = z.infer<typeof appSnapshotSchema>
export type ProjectCandidate = z.infer<typeof projectCandidateSchema>
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: IpcError }

export interface PictorBridge {
  getAppInfo: () => Promise<AppInfo>
  checkForUpdates: () => Promise<IpcResult<UpdateCheckResult>>
  openUpdate: () => Promise<IpcResult<null>>
  getSnapshot: () => Promise<IpcResult<AppSnapshot>>
  pickProjectDirectory: () => Promise<IpcResult<ProjectCandidate | null>>
  registerProject: (
    request: z.infer<typeof registerProjectRequestSchema>,
  ) => Promise<IpcResult<Project>>
  relinkProject: (
    request: z.infer<typeof relinkProjectRequestSchema>,
  ) => Promise<IpcResult<Project>>
  removeProject: (request: z.infer<typeof projectIdRequestSchema>) => Promise<IpcResult<null>>
  selectContext: (request: z.infer<typeof selectContextRequestSchema>) => Promise<IpcResult<null>>
  createSession: (
    request: z.infer<typeof createSessionRequestSchema>,
  ) => Promise<IpcResult<SessionSummary>>
  renameSession: (
    request: z.infer<typeof renameSessionRequestSchema>,
  ) => Promise<IpcResult<SessionSummary>>
  deleteSession: (request: z.infer<typeof sessionIdRequestSchema>) => Promise<IpcResult<null>>
  getSession: (request: z.infer<typeof sessionIdRequestSchema>) => Promise<IpcResult<SessionRecord>>
  getSettings: () => Promise<IpcResult<ModelSettings | null>>
  saveSettings: (request: SaveSettingsRequest) => Promise<IpcResult<ModelSettings>>
  testSettings: (request: TestSettingsRequest) => Promise<IpcResult<ConnectionTestResult>>
  listModels: (request: ListModelsRequest) => Promise<IpcResult<ModelCatalogResult>>
  startRun: (
    request: z.infer<typeof startRunRequestSchema>,
  ) => Promise<IpcResult<{ runId: string }>>
  approveCommand: (
    request: z.infer<typeof approvalResolutionRequestSchema>,
  ) => Promise<IpcResult<null>>
  rejectCommand: (
    request: z.infer<typeof approvalResolutionRequestSchema>,
  ) => Promise<IpcResult<null>>
  stopRun: (request: z.infer<typeof runIdRequestSchema>) => Promise<IpcResult<null>>
  onRuntimeEvent: (listener: (event: RuntimeEvent) => void) => () => void
}

export {
  listModelsRequestSchema,
  runtimeEventSchema,
  saveSettingsRequestSchema,
  testSettingsRequestSchema,
}
export type { RuntimeEvent } from './runtime-protocol.js'
