import { z } from 'zod'

export const timestampSchema = z.iso.datetime()
export const idSchema = z.uuid()

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
  kind: z.enum(['list', 'search', 'read', 'write', 'edit', 'move', 'delete', 'command', 'custom']),
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
  .extend({
    lastRunStatus: runStatusSchema.nullable(),
    historyAuthority: z.enum(['pi-jsonl', 'legacy-import']).optional(),
  })

export const sessionHistoryStateSchema = z.object({
  authority: z.enum(['pi-jsonl', 'legacy-import']),
  piSessionId: z.string().min(1).nullable(),
  piSessionFile: z.string().min(1).nullable(),
  legacyImport: z.object({
    status: z.enum(['not-required', 'pending', 'imported']),
    sourceFile: z.string().min(1).nullable(),
  }),
})

export const dataIssueSchema = z.object({
  code: z.enum([
    'session-corrupt',
    'persistence-failed',
    'credential-migration-failed',
    'legacy-session-import-pending',
  ]),
  sessionId: idSchema.nullable(),
  message: z.string().min(1),
})

export type Project = z.infer<typeof projectSchema>
export type SessionRecord = z.infer<typeof sessionRecordSchema>
export type SessionSummary = z.infer<typeof sessionSummarySchema>
export type SessionHistoryState = z.infer<typeof sessionHistoryStateSchema>
export type RunRecord = z.infer<typeof runRecordSchema>
export type ToolEvent = z.infer<typeof toolEventSchema>
export type DataIssue = z.infer<typeof dataIssueSchema>
