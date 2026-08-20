import { z } from 'zod'

import {
  dataIssueSchema,
  idSchema,
  projectSchema,
  sessionHistoryViewSchema,
  sessionRecordSchema,
  sessionSummarySchema,
  type Project,
  type SessionHistoryView,
  type SessionRecord,
  type SessionSummary,
} from './domain.js'
import { ipcResultSchema, type IpcResult } from './errors.js'
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
import {
  runtimeEventSchema,
  sessionExportFormatSchema,
  type RuntimeEvent,
} from './runtime-protocol.js'
import { appInfoSchema, type AppInfo } from './app-info.js'
import { pluginBootstrapSchema, type PluginBootstrap } from './plugins.js'
import type {
  pluginIdRequestSchema,
  removePluginRequestSchema,
  setPluginEnabledRequestSchema,
  PluginManagerSnapshot,
} from './plugins.js'
import { pluginManagerSnapshotSchema } from './plugins.js'

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
export const inspectSessionHistoryRequestSchema = sessionIdRequestSchema.extend({
  entryId: z.string().min(1).nullable(),
})
export const navigateSessionTreeRequestSchema = sessionIdRequestSchema.extend({
  entryId: z.string().min(1),
})
export const compactSessionRequestSchema = sessionIdRequestSchema.extend({
  customInstructions: z.string().trim().max(20_000).nullable(),
})
export const forkSessionRequestSchema = sessionIdRequestSchema.extend({
  entryId: z.string().min(1),
})
export const cloneSessionRequestSchema = sessionIdRequestSchema
export const importSessionRequestSchema = projectIdRequestSchema
export const exportSessionRequestSchema = sessionIdRequestSchema.extend({
  format: sessionExportFormatSchema,
})
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
export const extensionUiResponseRequestSchema = z.object({
  runId: idSchema,
  requestId: z.uuid(),
  value: z.union([z.string(), z.boolean(), z.null()]),
})
export const queueRuntimeMessageRequestSchema = z.object({
  runId: idSchema,
  mode: z.enum(['steer', 'follow-up']),
  message: z.string().trim().min(1).max(200_000),
})

export const appSnapshotResultSchema = ipcResultSchema(appSnapshotSchema)
export const appInfoResultSchema = ipcResultSchema(appInfoSchema)
export const pluginBootstrapResultSchema = ipcResultSchema(pluginBootstrapSchema)
export const pluginManagerResultSchema = ipcResultSchema(pluginManagerSnapshotSchema)
export const projectCandidateResultSchema = ipcResultSchema(projectCandidateSchema.nullable())
export const projectResultSchema = ipcResultSchema(projectSchema)
export const sessionSummaryResultSchema = ipcResultSchema(sessionSummarySchema)
export const sessionRecordResultSchema = ipcResultSchema(sessionRecordSchema)
export const sessionHistoryViewResultSchema = ipcResultSchema(sessionHistoryViewSchema)
export const navigateSessionTreeResultSchema = ipcResultSchema(sessionHistoryViewSchema.nullable())
export const compactSessionResultSchema = ipcResultSchema(sessionHistoryViewSchema.nullable())
export const cancelSessionOperationResultSchema = ipcResultSchema(z.boolean())
export const forkSessionResultSchema = ipcResultSchema(sessionSummarySchema.nullable())
export const cloneSessionResultSchema = ipcResultSchema(sessionSummarySchema.nullable())
export const importSessionResultSchema = ipcResultSchema(sessionSummarySchema.nullable())
export const exportSessionResultSchema = ipcResultSchema(z.boolean())
export const settingsResultSchema = ipcResultSchema(modelSettingsSchema.nullable())
export const savedSettingsResultSchema = ipcResultSchema(modelSettingsSchema)
export const connectionTestIpcResultSchema = ipcResultSchema(connectionTestResultSchema)
export const modelCatalogIpcResultSchema = ipcResultSchema(modelCatalogResultSchema)
export const voidResultSchema = ipcResultSchema(z.null())
export const startRunResultSchema = ipcResultSchema(z.object({ runId: idSchema }))

export type AppSnapshot = z.infer<typeof appSnapshotSchema>
export type ProjectCandidate = z.infer<typeof projectCandidateSchema>
export type SessionExportFormat = z.infer<typeof sessionExportFormatSchema>

export interface PictorBridge {
  getSnapshot: () => Promise<IpcResult<AppSnapshot>>
  getAppInfo: () => Promise<IpcResult<AppInfo>>
  getPluginBootstrap: () => Promise<IpcResult<PluginBootstrap>>
  getPluginManagerSnapshot: () => Promise<IpcResult<PluginManagerSnapshot>>
  installLocalPlugin: () => Promise<IpcResult<PluginManagerSnapshot>>
  installPiExtension: () => Promise<IpcResult<PluginManagerSnapshot>>
  installPiPackage: () => Promise<IpcResult<PluginManagerSnapshot>>
  setPluginEnabled: (
    request: z.infer<typeof setPluginEnabledRequestSchema>,
  ) => Promise<IpcResult<PluginManagerSnapshot>>
  removePlugin: (
    request: z.infer<typeof removePluginRequestSchema>,
  ) => Promise<IpcResult<PluginManagerSnapshot>>
  restoreBundledPlugin: (
    request: z.infer<typeof pluginIdRequestSchema>,
  ) => Promise<IpcResult<PluginManagerSnapshot>>
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
  inspectSessionHistory: (
    request: z.infer<typeof inspectSessionHistoryRequestSchema>,
  ) => Promise<IpcResult<SessionHistoryView>>
  navigateSessionTree: (
    request: z.infer<typeof navigateSessionTreeRequestSchema>,
  ) => Promise<IpcResult<SessionHistoryView | null>>
  compactSession: (
    request: z.infer<typeof compactSessionRequestSchema>,
  ) => Promise<IpcResult<SessionHistoryView | null>>
  cancelSessionOperation: (
    request: z.infer<typeof sessionIdRequestSchema>,
  ) => Promise<IpcResult<boolean>>
  forkSession: (
    request: z.infer<typeof forkSessionRequestSchema>,
  ) => Promise<IpcResult<SessionSummary | null>>
  cloneSession: (
    request: z.infer<typeof cloneSessionRequestSchema>,
  ) => Promise<IpcResult<SessionSummary | null>>
  importSession: (
    request: z.infer<typeof importSessionRequestSchema>,
  ) => Promise<IpcResult<SessionSummary | null>>
  exportSession: (
    request: z.infer<typeof exportSessionRequestSchema>,
  ) => Promise<IpcResult<boolean>>
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
  respondToExtensionUi: (
    request: z.infer<typeof extensionUiResponseRequestSchema>,
  ) => Promise<IpcResult<null>>
  queueRuntimeMessage: (
    request: z.infer<typeof queueRuntimeMessageRequestSchema>,
  ) => Promise<IpcResult<null>>
  clearRuntimeQueue: (request: z.infer<typeof runIdRequestSchema>) => Promise<IpcResult<null>>
  onRuntimeEvent: (listener: (event: RuntimeEvent) => void) => () => void
}

export {
  listModelsRequestSchema,
  runtimeEventSchema,
  saveSettingsRequestSchema,
  testSettingsRequestSchema,
}
export {
  pluginIdRequestSchema,
  removePluginRequestSchema,
  setPluginEnabledRequestSchema,
} from './plugins.js'
export type { RuntimeEvent } from './runtime-protocol.js'
export type { IpcResult } from './errors.js'
