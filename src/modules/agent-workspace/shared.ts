import { z } from 'zod'

import {
  defineModuleContract,
  invokeModuleMethod,
  type ModuleTransport,
} from '../../kernel/contract.js'
import {
  dataIssueSchema,
  idSchema,
  imageAttachmentSchema,
  projectSchema,
  sessionHistoryViewSchema,
  sessionRecordSchema,
  sessionSummarySchema,
  type Project,
  type SessionHistoryView,
  type SessionRecord,
  type SessionSummary,
} from '../../shared/domain.js'
import { ipcResultSchema, type IpcResult } from '../../shared/errors.js'
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
} from '../../shared/model.js'
import {
  runtimeEventSchema,
  sessionExportFormatSchema,
  type RuntimeEvent,
} from '../../shared/runtime-protocol.js'

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
  summarize: z.boolean().default(false),
  customInstructions: z.string().trim().max(20_000).nullable().default(null),
})
export const compactSessionRequestSchema = sessionIdRequestSchema.extend({
  customInstructions: z.string().trim().max(20_000).nullable(),
})
export const labelSessionEntryRequestSchema = sessionIdRequestSchema.extend({
  entryId: z.string().min(1),
  label: z.string().trim().max(120).nullable(),
})
export const sessionRuntimeControlsSchema = z.object({
  modelId: z.string().min(1),
  thinkingLevel: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']),
  activeTools: z.array(z.string().min(1)),
  availableTools: z.array(z.string().min(1)),
  steeringMode: z.enum(['all', 'one-at-a-time']),
  followUpMode: z.enum(['all', 'one-at-a-time']),
})
export const saveSessionRuntimeControlsRequestSchema = sessionIdRequestSchema.extend({
  controls: sessionRuntimeControlsSchema.omit({ availableTools: true }),
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
  images: z.array(imageAttachmentSchema).optional(),
})
export const runIdRequestSchema = z.object({ runId: idSchema })
export const extensionUiResponseRequestSchema = z.object({
  sessionId: idSchema,
  requestId: z.uuid(),
  value: z.union([z.string(), z.boolean(), z.null()]),
})
export const composerTextRequestSchema = z.object({
  sessionId: idSchema,
  text: z.string().max(200_000),
})
export const queueRuntimeMessageRequestSchema = z.object({
  runId: idSchema,
  mode: z.enum(['steer', 'follow-up']),
  message: z.string().trim().min(1).max(200_000),
})

export const appSnapshotResultSchema = ipcResultSchema(appSnapshotSchema)
export const projectCandidateResultSchema = ipcResultSchema(projectCandidateSchema.nullable())
export const projectResultSchema = ipcResultSchema(projectSchema)
export const sessionSummaryResultSchema = ipcResultSchema(sessionSummarySchema)
export const sessionRecordResultSchema = ipcResultSchema(sessionRecordSchema)
export const sessionHistoryViewResultSchema = ipcResultSchema(sessionHistoryViewSchema)
export const sessionNavigationResultSchema = z.object({
  history: sessionHistoryViewSchema,
  editorText: z.string().nullable(),
  summaryCreated: z.boolean(),
})
export const navigateSessionTreeResultSchema = ipcResultSchema(
  sessionNavigationResultSchema.nullable(),
)
export const compactSessionResultSchema = ipcResultSchema(sessionHistoryViewSchema.nullable())
export const cancelSessionOperationResultSchema = ipcResultSchema(z.boolean())
export const sessionRuntimeControlsResultSchema = ipcResultSchema(sessionRuntimeControlsSchema)
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
export const imageAttachmentsResultSchema = ipcResultSchema(z.array(imageAttachmentSchema))

export const agentWorkspaceContract = defineModuleContract({
  id: 'pictor.agent-workspace',
  methods: {
    getSnapshot: { input: z.null(), output: appSnapshotResultSchema },
    pickProjectDirectory: { input: z.null(), output: projectCandidateResultSchema },
    registerProject: { input: registerProjectRequestSchema, output: projectResultSchema },
    relinkProject: { input: relinkProjectRequestSchema, output: projectResultSchema },
    removeProject: { input: projectIdRequestSchema, output: voidResultSchema },
    selectContext: { input: selectContextRequestSchema, output: voidResultSchema },
    createSession: { input: createSessionRequestSchema, output: sessionSummaryResultSchema },
    renameSession: { input: renameSessionRequestSchema, output: sessionSummaryResultSchema },
    deleteSession: { input: sessionIdRequestSchema, output: voidResultSchema },
    getSession: { input: sessionIdRequestSchema, output: sessionRecordResultSchema },
    inspectSessionHistory: {
      input: inspectSessionHistoryRequestSchema,
      output: sessionHistoryViewResultSchema,
    },
    navigateSessionTree: {
      input: navigateSessionTreeRequestSchema,
      output: navigateSessionTreeResultSchema,
    },
    compactSession: { input: compactSessionRequestSchema, output: compactSessionResultSchema },
    labelSessionEntry: {
      input: labelSessionEntryRequestSchema,
      output: sessionHistoryViewResultSchema,
    },
    cancelSessionOperation: {
      input: sessionIdRequestSchema,
      output: cancelSessionOperationResultSchema,
    },
    getSessionRuntimeControls: {
      input: sessionIdRequestSchema,
      output: sessionRuntimeControlsResultSchema,
    },
    saveSessionRuntimeControls: {
      input: saveSessionRuntimeControlsRequestSchema,
      output: sessionRuntimeControlsResultSchema,
    },
    reloadSessionResources: { input: sessionIdRequestSchema, output: voidResultSchema },
    forkSession: { input: forkSessionRequestSchema, output: forkSessionResultSchema },
    cloneSession: { input: cloneSessionRequestSchema, output: cloneSessionResultSchema },
    importSession: { input: importSessionRequestSchema, output: importSessionResultSchema },
    exportSession: { input: exportSessionRequestSchema, output: exportSessionResultSchema },
    getSettings: { input: z.null(), output: settingsResultSchema },
    saveSettings: { input: saveSettingsRequestSchema, output: savedSettingsResultSchema },
    testSettings: { input: testSettingsRequestSchema, output: connectionTestIpcResultSchema },
    listModels: { input: listModelsRequestSchema, output: modelCatalogIpcResultSchema },
    startRun: { input: startRunRequestSchema, output: startRunResultSchema },
    pickMessageImages: { input: z.null(), output: imageAttachmentsResultSchema },
    stopRun: { input: runIdRequestSchema, output: voidResultSchema },
    respondToExtensionUi: { input: extensionUiResponseRequestSchema, output: voidResultSchema },
    syncComposerText: { input: composerTextRequestSchema, output: voidResultSchema },
    queueRuntimeMessage: { input: queueRuntimeMessageRequestSchema, output: voidResultSchema },
    clearRuntimeQueue: { input: runIdRequestSchema, output: voidResultSchema },
  },
  events: {
    runtimeEvent: { payload: runtimeEventSchema },
  },
})

export type AppSnapshot = z.infer<typeof appSnapshotSchema>
export type ProjectCandidate = z.infer<typeof projectCandidateSchema>
export type SessionExportFormat = z.infer<typeof sessionExportFormatSchema>
export type SessionRuntimeControls = z.infer<typeof sessionRuntimeControlsSchema>

export interface AgentWorkspaceClient {
  getSnapshot(): Promise<IpcResult<AppSnapshot>>
  pickProjectDirectory(): Promise<IpcResult<ProjectCandidate | null>>
  registerProject(
    request: z.infer<typeof registerProjectRequestSchema>,
  ): Promise<IpcResult<Project>>
  relinkProject(request: z.infer<typeof relinkProjectRequestSchema>): Promise<IpcResult<Project>>
  removeProject(request: z.infer<typeof projectIdRequestSchema>): Promise<IpcResult<null>>
  selectContext(request: z.infer<typeof selectContextRequestSchema>): Promise<IpcResult<null>>
  createSession(
    request: z.infer<typeof createSessionRequestSchema>,
  ): Promise<IpcResult<SessionSummary>>
  renameSession(
    request: z.infer<typeof renameSessionRequestSchema>,
  ): Promise<IpcResult<SessionSummary>>
  deleteSession(request: z.infer<typeof sessionIdRequestSchema>): Promise<IpcResult<null>>
  getSession(request: z.infer<typeof sessionIdRequestSchema>): Promise<IpcResult<SessionRecord>>
  inspectSessionHistory(
    request: z.infer<typeof inspectSessionHistoryRequestSchema>,
  ): Promise<IpcResult<SessionHistoryView>>
  navigateSessionTree(
    request: z.infer<typeof navigateSessionTreeRequestSchema>,
  ): Promise<IpcResult<z.infer<typeof sessionNavigationResultSchema> | null>>
  compactSession(
    request: z.infer<typeof compactSessionRequestSchema>,
  ): Promise<IpcResult<SessionHistoryView | null>>
  labelSessionEntry(
    request: z.infer<typeof labelSessionEntryRequestSchema>,
  ): Promise<IpcResult<SessionHistoryView>>
  cancelSessionOperation(
    request: z.infer<typeof sessionIdRequestSchema>,
  ): Promise<IpcResult<boolean>>
  getSessionRuntimeControls(
    request: z.infer<typeof sessionIdRequestSchema>,
  ): Promise<IpcResult<SessionRuntimeControls>>
  saveSessionRuntimeControls(
    request: z.infer<typeof saveSessionRuntimeControlsRequestSchema>,
  ): Promise<IpcResult<SessionRuntimeControls>>
  reloadSessionResources(request: z.infer<typeof sessionIdRequestSchema>): Promise<IpcResult<null>>
  forkSession(
    request: z.infer<typeof forkSessionRequestSchema>,
  ): Promise<IpcResult<SessionSummary | null>>
  cloneSession(
    request: z.infer<typeof cloneSessionRequestSchema>,
  ): Promise<IpcResult<SessionSummary | null>>
  importSession(
    request: z.infer<typeof importSessionRequestSchema>,
  ): Promise<IpcResult<SessionSummary | null>>
  exportSession(request: z.infer<typeof exportSessionRequestSchema>): Promise<IpcResult<boolean>>
  getSettings(): Promise<IpcResult<ModelSettings | null>>
  saveSettings(request: SaveSettingsRequest): Promise<IpcResult<ModelSettings>>
  testSettings(request: TestSettingsRequest): Promise<IpcResult<ConnectionTestResult>>
  listModels(request: ListModelsRequest): Promise<IpcResult<ModelCatalogResult>>
  startRun(request: z.infer<typeof startRunRequestSchema>): Promise<IpcResult<{ runId: string }>>
  pickMessageImages(): Promise<IpcResult<z.infer<typeof imageAttachmentSchema>[]>>
  stopRun(request: z.infer<typeof runIdRequestSchema>): Promise<IpcResult<null>>
  respondToExtensionUi(
    request: z.infer<typeof extensionUiResponseRequestSchema>,
  ): Promise<IpcResult<null>>
  syncComposerText(request: z.infer<typeof composerTextRequestSchema>): Promise<IpcResult<null>>
  queueRuntimeMessage(
    request: z.infer<typeof queueRuntimeMessageRequestSchema>,
  ): Promise<IpcResult<null>>
  clearRuntimeQueue(request: z.infer<typeof runIdRequestSchema>): Promise<IpcResult<null>>
  onRuntimeEvent(listener: (event: RuntimeEvent) => void): () => void
}

export function createAgentWorkspaceClient(transport: ModuleTransport): AgentWorkspaceClient {
  const invoke = <Method extends keyof typeof agentWorkspaceContract.methods & string>(
    method: Method,
    input: z.input<(typeof agentWorkspaceContract.methods)[Method]['input']>,
  ) => invokeModuleMethod(transport, agentWorkspaceContract, method, input)

  return {
    getSnapshot: () => invoke('getSnapshot', null),
    pickProjectDirectory: () => invoke('pickProjectDirectory', null),
    registerProject: (request) => invoke('registerProject', request),
    relinkProject: (request) => invoke('relinkProject', request),
    removeProject: (request) => invoke('removeProject', request),
    selectContext: (request) => invoke('selectContext', request),
    createSession: (request) => invoke('createSession', request),
    renameSession: (request) => invoke('renameSession', request),
    deleteSession: (request) => invoke('deleteSession', request),
    getSession: (request) => invoke('getSession', request),
    inspectSessionHistory: (request) => invoke('inspectSessionHistory', request),
    navigateSessionTree: (request) => invoke('navigateSessionTree', request),
    compactSession: (request) => invoke('compactSession', request),
    labelSessionEntry: (request) => invoke('labelSessionEntry', request),
    cancelSessionOperation: (request) => invoke('cancelSessionOperation', request),
    getSessionRuntimeControls: (request) => invoke('getSessionRuntimeControls', request),
    saveSessionRuntimeControls: (request) => invoke('saveSessionRuntimeControls', request),
    reloadSessionResources: (request) => invoke('reloadSessionResources', request),
    forkSession: (request) => invoke('forkSession', request),
    cloneSession: (request) => invoke('cloneSession', request),
    importSession: (request) => invoke('importSession', request),
    exportSession: (request) => invoke('exportSession', request),
    getSettings: () => invoke('getSettings', null),
    saveSettings: (request) => invoke('saveSettings', request),
    testSettings: (request) => invoke('testSettings', request),
    listModels: (request) => invoke('listModels', request),
    startRun: (request) => invoke('startRun', request),
    pickMessageImages: () => invoke('pickMessageImages', null),
    stopRun: (request) => invoke('stopRun', request),
    respondToExtensionUi: (request) => invoke('respondToExtensionUi', request),
    syncComposerText: (request) => invoke('syncComposerText', request),
    queueRuntimeMessage: (request) => invoke('queueRuntimeMessage', request),
    clearRuntimeQueue: (request) => invoke('clearRuntimeQueue', request),
    onRuntimeEvent: (listener) =>
      transport.onEvent(agentWorkspaceContract.id, 'runtimeEvent', (payload) => {
        listener(runtimeEventSchema.parse(payload))
      }),
  }
}

export { listModelsRequestSchema, saveSettingsRequestSchema, testSettingsRequestSchema }
export type { IpcResult } from '../../shared/errors.js'
export type { RuntimeEvent } from '../../shared/runtime-protocol.js'
