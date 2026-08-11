import { z } from 'zod'

const timestampSchema = z.iso.datetime()
const idSchema = z.uuid()

export const appInfoSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  platform: z.literal('win32'),
})

export const projectAvailabilitySchema = z.enum(['available', 'missing', 'inaccessible'])

export const projectSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(120),
  rootPath: z.string().min(1),
  trustedAt: timestampSchema,
  availability: projectAvailabilitySchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})

export const runStatusSchema = z.enum([
  'queued',
  'running',
  'awaiting-approval',
  'stopping',
  'completed',
  'failed',
  'stopped',
  'interrupted',
])

export const messageSchema = z.object({
  id: idSchema,
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  status: z.enum(['streaming', 'completed', 'failed']),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})

export const toolEventSchema = z.object({
  id: idSchema,
  callId: z.string().min(1),
  kind: z.enum(['list', 'search', 'read', 'write', 'edit', 'move', 'delete', 'command']),
  label: z.string().min(1),
  path: z.string().nullable(),
  command: z
    .object({
      command: z.string().min(1),
      cwd: z.string().min(1),
      purpose: z.string().min(1),
      approval: z.enum(['pending', 'allowed', 'rejected']),
    })
    .nullable(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'rejected']),
  output: z.string().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})

export const runRecordSchema = z.object({
  id: idSchema,
  status: runStatusSchema,
  toolEvents: z.array(toolEventSchema),
  error: z.string().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})

export const sessionRecordSchema = z.object({
  schemaVersion: z.literal(1),
  id: idSchema,
  projectId: idSchema,
  title: z.string().trim().min(1).max(120),
  messages: z.array(messageSchema),
  runs: z.array(runRecordSchema),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})

export const sessionSummarySchema = sessionRecordSchema
  .pick({ id: true, projectId: true, title: true, createdAt: true, updatedAt: true })
  .extend({ lastRunStatus: runStatusSchema.nullable() })

export const baseUrlSchema = z
  .string()
  .trim()
  .url('请输入有效的 API Base URL')
  .superRefine((value, context) => {
    const url = new URL(value)
    const isLoopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)

    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
      context.addIssue({
        code: 'custom',
        message: '远程地址必须使用 HTTPS；HTTP 仅允许本机回环地址',
      })
    }
  })

export const apiProtocolSchema = z
  .enum(['chat-completions', 'responses'])
  .default('chat-completions')

export const modelSettingsInputSchema = z.object({
  apiProtocol: apiProtocolSchema,
  baseUrl: baseUrlSchema,
  modelId: z
    .string()
    .trim()
    .min(1, '请输入模型标识')
    .max(200)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/, '模型标识包含不支持的字符'),
  temperature: z.number().min(0).max(2).nullable(),
  maxOutputTokens: z.number().int().min(1).max(1_000_000).nullable(),
})

export const modelSettingsSchema = modelSettingsInputSchema.extend({
  hasApiKey: z.boolean(),
})

export const apiKeyChangeSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('keep') }),
  z.object({ action: z.literal('clear') }),
  z.object({ action: z.literal('replace'), value: z.string().trim().min(1).max(16_384) }),
])

export const saveSettingsRequestSchema = modelSettingsInputSchema.extend({
  apiKey: apiKeyChangeSchema,
})

export const testSettingsRequestSchema = modelSettingsInputSchema.extend({
  apiKey: z.string().trim().min(1).max(16_384).optional(),
})

export const connectionTestResultSchema = z.object({
  outcome: z.enum(['success', 'authentication', 'connectivity', 'model', 'server', 'incompatible']),
  message: z.string().min(1),
})

export const dataIssueSchema = z.object({
  code: z.enum(['session-corrupt', 'persistence-failed']),
  sessionId: idSchema.nullable(),
  message: z.string().min(1),
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

export const ipcErrorSchema = z.object({
  code: z.enum([
    'invalid-input',
    'not-found',
    'project-unavailable',
    'credential-unavailable',
    'persistence-failed',
    'internal',
  ]),
  message: z.string().min(1),
  field: z.string().optional(),
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
export const voidResultSchema = ipcResultSchema(z.null())

export const startRunRequestSchema = z.object({
  sessionId: idSchema,
  prompt: z.string().trim().min(1).max(200_000),
})
export const runIdRequestSchema = z.object({ runId: idSchema })
export const approvalResolutionRequestSchema = z.object({
  runId: idSchema,
  callId: z.string().min(1),
})
export const startRunResultSchema = ipcResultSchema(z.object({ runId: idSchema }))

const runtimeEventBaseSchema = z.object({
  runId: idSchema,
  sessionId: idSchema,
  at: timestampSchema,
})

export const runtimeEventSchema = z.discriminatedUnion('type', [
  runtimeEventBaseSchema.extend({
    type: z.literal('run.stateChanged'),
    status: runStatusSchema,
    error: z.string().nullable(),
  }),
  runtimeEventBaseSchema.extend({
    type: z.literal('message.started'),
    messageId: idSchema,
  }),
  runtimeEventBaseSchema.extend({
    type: z.literal('message.delta'),
    messageId: idSchema,
    delta: z.string(),
  }),
  runtimeEventBaseSchema.extend({
    type: z.literal('message.completed'),
    messageId: idSchema,
    content: z.string(),
  }),
  runtimeEventBaseSchema.extend({
    type: z.literal('tool.started'),
    callId: z.string().min(1),
    kind: toolEventSchema.shape.kind,
    label: z.string().min(1),
    path: z.string().nullable(),
  }),
  runtimeEventBaseSchema.extend({
    type: z.literal('tool.updated'),
    callId: z.string().min(1),
    output: z.string(),
  }),
  runtimeEventBaseSchema.extend({
    type: z.literal('tool.completed'),
    callId: z.string().min(1),
    output: z.string(),
    isError: z.boolean(),
  }),
  runtimeEventBaseSchema.extend({
    type: z.literal('approval.requested'),
    callId: z.string().min(1),
    command: z.string().min(1),
    cwd: z.string().min(1),
    purpose: z.string().min(1),
  }),
  runtimeEventBaseSchema.extend({
    type: z.literal('approval.resolved'),
    callId: z.string().min(1),
    allowed: z.boolean(),
  }),
  runtimeEventBaseSchema.extend({
    type: z.literal('runtime.error'),
    category: z.enum(['authentication', 'connectivity', 'model', 'server', 'runtime']),
    message: z.string().min(1),
  }),
])

export type AppInfo = z.infer<typeof appInfoSchema>
export type AppSnapshot = z.infer<typeof appSnapshotSchema>
export type Project = z.infer<typeof projectSchema>
export type ProjectCandidate = z.infer<typeof projectCandidateSchema>
export type SessionRecord = z.infer<typeof sessionRecordSchema>
export type SessionSummary = z.infer<typeof sessionSummarySchema>
export type RunRecord = z.infer<typeof runRecordSchema>
export type ToolEvent = z.infer<typeof toolEventSchema>
export type ModelSettings = z.infer<typeof modelSettingsSchema>
export type ModelSettingsInput = z.infer<typeof modelSettingsInputSchema>
export type SaveSettingsRequest = z.infer<typeof saveSettingsRequestSchema>
export type TestSettingsRequest = z.infer<typeof testSettingsRequestSchema>
export type ConnectionTestResult = z.infer<typeof connectionTestResultSchema>
export type RuntimeEvent = z.infer<typeof runtimeEventSchema>
export type IpcError = z.infer<typeof ipcErrorSchema>
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: IpcError }

export interface PictorBridge {
  getAppInfo: () => Promise<AppInfo>
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
