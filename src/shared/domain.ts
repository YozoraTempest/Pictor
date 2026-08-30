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

export const imageAttachmentSchema = z.object({
  data: z.string().min(1),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  name: z.string().min(1).nullable(),
})

export const messageSchema = z.object({
  id: idSchema,
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  images: z.array(imageAttachmentSchema).optional(),
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

export const usageSnapshotSchema = z.object({
  tokens: z.object({
    input: z.number().nonnegative(),
    output: z.number().nonnegative(),
    cacheRead: z.number().nonnegative(),
    cacheWrite: z.number().nonnegative(),
    total: z.number().nonnegative(),
  }),
  cost: z.number().nonnegative(),
  context: z
    .object({
      tokens: z.number().nonnegative().nullable(),
      contextWindow: z.number().positive(),
      percent: z.number().nonnegative().nullable(),
    })
    .nullable(),
})

export const sessionTreeNodeSchema = z.object({
  id: z.string().min(1),
  parentId: z.string().min(1).nullable(),
  kind: z.enum([
    'user',
    'assistant',
    'tool-result',
    'compaction',
    'branch-summary',
    'model',
    'thinking',
    'custom',
    'custom-message',
    'label',
    'session-info',
    'unknown',
  ]),
  label: z.string().min(1),
  timestamp: timestampSchema,
  depth: z.number().int().nonnegative(),
  childCount: z.number().int().nonnegative(),
  isActivePath: z.boolean(),
  isActiveLeaf: z.boolean(),
  isSelected: z.boolean(),
})

export const sessionTreeViewSchema = z.object({
  nodes: z.array(sessionTreeNodeSchema),
  activeLeafId: z.string().min(1).nullable(),
  selectedEntryId: z.string().min(1).nullable(),
})

export const sessionRecordSchema = z.object({
  schemaVersion: z.literal(1),
  id: idSchema,
  projectId: idSchema,
  title: z.string().trim().min(1).max(120),
  messages: z.array(messageSchema),
  runs: z.array(runRecordSchema),
  usage: usageSnapshotSchema.nullable().optional(),
  runtimeState: z
    .object({
      modelId: z.string().min(1).nullable(),
      modelProvider: z.string().min(1).nullable(),
      thinkingLevel: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).nullable(),
    })
    .optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})

export const sessionHistoryViewSchema = z.object({
  session: sessionRecordSchema,
  tree: sessionTreeViewSchema.nullable(),
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
  // Pi owns the location of the JSONL file.  Pictor stores the exact path so
  // session replacement can bind a new Pi session without moving its file.
  piSessionPath: z.string().min(1).nullable(),
  activeLeafId: z.string().min(1).nullable().optional(),
  runtimePreferences: z
    .object({
      modelId: z.string().min(1).nullable().default(null),
      thinkingLevel: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).nullable(),
      activeTools: z.array(z.string().min(1)).nullable(),
      steeringMode: z.enum(['all', 'one-at-a-time']),
      followUpMode: z.enum(['all', 'one-at-a-time']),
    })
    .optional(),
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
export type ImageAttachment = z.infer<typeof imageAttachmentSchema>
export type SessionRecord = z.infer<typeof sessionRecordSchema>
export type SessionHistoryView = z.infer<typeof sessionHistoryViewSchema>
export type SessionSummary = z.infer<typeof sessionSummarySchema>
export type SessionHistoryState = z.infer<typeof sessionHistoryStateSchema>
export type UsageSnapshot = z.infer<typeof usageSnapshotSchema>
export type SessionTreeNode = z.infer<typeof sessionTreeNodeSchema>
export type SessionTreeView = z.infer<typeof sessionTreeViewSchema>
export type RunRecord = z.infer<typeof runRecordSchema>
export type ToolEvent = z.infer<typeof toolEventSchema>
export type DataIssue = z.infer<typeof dataIssueSchema>
