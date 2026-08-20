import { z } from 'zod'

import {
  idSchema,
  runStatusSchema,
  timestampSchema,
  toolEventSchema,
  usageSnapshotSchema,
} from './domain.js'
import { modelSettingsInputSchema } from './model.js'

const runtimeEventBaseSchema = z.object({
  runId: idSchema,
  sessionId: idSchema,
  at: timestampSchema,
})

export const runtimeEventSchema = z.discriminatedUnion('type', [
  runtimeEventBaseSchema.extend({
    type: z.literal('session.bound'),
    piSessionId: z.string().min(1),
    piSessionFile: z.string().min(1),
  }),
  runtimeEventBaseSchema.extend({
    type: z.literal('session.activeLeafChanged'),
    activeLeafId: z.string().min(1).nullable(),
  }),
  runtimeEventBaseSchema.extend({
    type: z.literal('run.stateChanged'),
    status: runStatusSchema,
    error: z.string().nullable(),
  }),
  runtimeEventBaseSchema.extend({ type: z.literal('message.started'), messageId: idSchema }),
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
  runtimeEventBaseSchema.extend({
    type: z.literal('extension.ui.requested'),
    requestId: z.uuid(),
    kind: z.enum(['select', 'confirm', 'input', 'editor']),
    title: z.string(),
    message: z.string().nullable(),
    options: z.array(z.string()),
    value: z.string().nullable(),
  }),
  runtimeEventBaseSchema.extend({
    type: z.literal('extension.ui.notification'),
    level: z.enum(['info', 'warning', 'error']),
    message: z.string(),
  }),
  runtimeEventBaseSchema.extend({
    type: z.literal('extension.ui.status'),
    key: z.string(),
    text: z.string().nullable(),
  }),
  runtimeEventBaseSchema.extend({
    type: z.literal('queue.updated'),
    steering: z.array(z.string()),
    followUp: z.array(z.string()),
  }),
  runtimeEventBaseSchema.extend({
    type: z.literal('usage.updated'),
    ...usageSnapshotSchema.shape,
  }),
  runtimeEventBaseSchema.extend({
    type: z.literal('compaction.stateChanged'),
    status: z.enum(['running', 'completed', 'cancelled', 'failed']),
    reason: z.enum(['manual', 'threshold', 'overflow']),
    tokensBefore: z.number().int().nonnegative().nullable(),
    estimatedTokensAfter: z.number().int().nonnegative().nullable(),
    error: z.string().nullable(),
  }),
])

export const runtimeStartConfigSchema = z.object({
  type: z.literal('start'),
  runId: idSchema,
  sessionId: idSchema,
  messageId: idSchema,
  projectRoot: z.string().min(1),
  agentDirectory: z.string().min(1),
  sessionDirectory: z.string().min(1),
  resumeSession: z.boolean(),
  piSessionFile: z.string().min(1).nullable().optional(),
  activeLeafId: z.string().min(1).nullable().optional(),
  commandInterpreterPath: z.string().min(1).nullable().optional(),
  settings: modelSettingsInputSchema,
  apiKey: z.string().min(1),
  prompt: z.string().min(1),
})

export const runtimeForkConfigSchema = z.object({
  type: z.literal('fork'),
  operationId: idSchema,
  sourceSessionId: idSchema,
  targetSessionId: idSchema,
  entryId: z.string().min(1),
  projectRoot: z.string().min(1),
  agentDirectory: z.string().min(1),
  sourceSessionDirectory: z.string().min(1),
  sourcePiSessionFile: z.string().min(1),
  targetSessionDirectory: z.string().min(1),
  settings: modelSettingsInputSchema,
  apiKey: z.string().min(1),
})

const runtimeForkResultBaseSchema = z.object({
  type: z.literal('host.forkResult'),
  operationId: idSchema,
  targetSessionId: idSchema,
})

export const runtimeForkResultSchema = z.discriminatedUnion('outcome', [
  runtimeForkResultBaseSchema.extend({
    outcome: z.literal('completed'),
    piSessionId: z.string().min(1),
    piSessionFile: z.string().min(1),
  }),
  runtimeForkResultBaseSchema.extend({ outcome: z.literal('cancelled') }),
  runtimeForkResultBaseSchema.extend({
    outcome: z.literal('failed'),
    message: z.string().min(1),
  }),
])

export const runtimeImportConfigSchema = z.object({
  type: z.literal('import'),
  operationId: idSchema,
  targetSessionId: idSchema,
  projectRoot: z.string().min(1),
  agentDirectory: z.string().min(1),
  sourceJsonlPath: z.string().min(1),
  targetSessionDirectory: z.string().min(1),
  settings: modelSettingsInputSchema,
  apiKey: z.string().min(1),
})

const runtimeImportResultBaseSchema = z.object({
  type: z.literal('host.importResult'),
  operationId: idSchema,
  targetSessionId: idSchema,
})

export const runtimeImportResultSchema = z.discriminatedUnion('outcome', [
  runtimeImportResultBaseSchema.extend({
    outcome: z.literal('completed'),
    piSessionId: z.string().min(1),
    piSessionFile: z.string().min(1),
  }),
  runtimeImportResultBaseSchema.extend({ outcome: z.literal('cancelled') }),
  runtimeImportResultBaseSchema.extend({
    outcome: z.literal('failed'),
    message: z.string().min(1),
  }),
])

export const sessionExportFormatSchema = z.enum(['jsonl', 'html'])

export const runtimeExportConfigSchema = z.object({
  type: z.literal('export'),
  operationId: idSchema,
  sourceSessionId: idSchema,
  format: sessionExportFormatSchema,
  projectRoot: z.string().min(1),
  agentDirectory: z.string().min(1),
  sourceSessionDirectory: z.string().min(1),
  sourcePiSessionFile: z.string().min(1),
  activeLeafId: z.string().min(1).nullable().optional(),
  destinationPath: z.string().min(1),
  settings: modelSettingsInputSchema,
  apiKey: z.string().min(1),
})

const runtimeExportResultBaseSchema = z.object({
  type: z.literal('host.exportResult'),
  operationId: idSchema,
  sourceSessionId: idSchema,
})

export const runtimeExportResultSchema = z.discriminatedUnion('outcome', [
  runtimeExportResultBaseSchema.extend({ outcome: z.literal('completed') }),
  runtimeExportResultBaseSchema.extend({
    outcome: z.literal('failed'),
    message: z.string().min(1),
  }),
])

export const runtimeNavigateConfigSchema = z.object({
  type: z.literal('navigate'),
  operationId: idSchema,
  sourceSessionId: idSchema,
  entryId: z.string().min(1),
  activeLeafId: z.string().min(1),
  projectRoot: z.string().min(1),
  agentDirectory: z.string().min(1),
  sourceSessionDirectory: z.string().min(1),
  sourcePiSessionFile: z.string().min(1),
  settings: modelSettingsInputSchema,
  apiKey: z.string().min(1),
})

const runtimeNavigateResultBaseSchema = z.object({
  type: z.literal('host.navigateResult'),
  operationId: idSchema,
  sourceSessionId: idSchema,
})

export const runtimeNavigateResultSchema = z.discriminatedUnion('outcome', [
  runtimeNavigateResultBaseSchema.extend({
    outcome: z.literal('completed'),
    activeLeafId: z.string().min(1).nullable(),
  }),
  runtimeNavigateResultBaseSchema.extend({ outcome: z.literal('cancelled') }),
  runtimeNavigateResultBaseSchema.extend({
    outcome: z.literal('failed'),
    message: z.string().min(1),
  }),
])

export const runtimeCompactConfigSchema = z.object({
  type: z.literal('compact'),
  operationId: idSchema,
  sourceSessionId: idSchema,
  customInstructions: z.string().trim().max(20_000).nullable(),
  activeLeafId: z.string().min(1),
  projectRoot: z.string().min(1),
  agentDirectory: z.string().min(1),
  sourceSessionDirectory: z.string().min(1),
  sourcePiSessionFile: z.string().min(1),
  settings: modelSettingsInputSchema,
  apiKey: z.string().min(1),
})

const runtimeCompactResultBaseSchema = z.object({
  type: z.literal('host.compactResult'),
  operationId: idSchema,
  sourceSessionId: idSchema,
})

export const runtimeCompactResultSchema = z.discriminatedUnion('outcome', [
  runtimeCompactResultBaseSchema.extend({
    outcome: z.literal('completed'),
    activeLeafId: z.string().min(1),
    tokensBefore: z.number().int().nonnegative(),
    estimatedTokensAfter: z.number().int().nonnegative().nullable(),
  }),
  runtimeCompactResultBaseSchema.extend({ outcome: z.literal('cancelled') }),
  runtimeCompactResultBaseSchema.extend({
    outcome: z.literal('failed'),
    message: z.string().min(1),
  }),
])

export const runtimeCommandSchema = z.discriminatedUnion('type', [
  runtimeStartConfigSchema,
  runtimeForkConfigSchema,
  runtimeImportConfigSchema,
  runtimeExportConfigSchema,
  runtimeNavigateConfigSchema,
  runtimeCompactConfigSchema,
  z.object({ type: z.literal('approve'), runId: idSchema, callId: z.string().min(1) }),
  z.object({ type: z.literal('reject'), runId: idSchema, callId: z.string().min(1) }),
  z.object({ type: z.literal('abort'), runId: idSchema }),
  z.object({
    type: z.enum(['steer', 'follow-up']),
    runId: idSchema,
    message: z.string().trim().min(1).max(200_000),
  }),
  z.object({ type: z.literal('clear-queue'), runId: idSchema }),
  z.object({
    type: z.literal('extension.ui.respond'),
    runId: idSchema,
    requestId: z.uuid(),
    value: z.union([z.string(), z.boolean(), z.null()]),
  }),
  z.object({ type: z.literal('dispose') }),
  z.object({ type: z.literal('abort-session-operation'), operationId: idSchema }),
])

export const runtimeHostMessageSchema = z.union([
  runtimeEventSchema,
  runtimeForkResultSchema,
  runtimeImportResultSchema,
  runtimeExportResultSchema,
  runtimeNavigateResultSchema,
  runtimeCompactResultSchema,
  z.object({ type: z.literal('host.ready') }),
  z.object({ type: z.literal('host.fatal'), message: z.string().min(1) }),
])

export type RuntimeEvent = z.infer<typeof runtimeEventSchema>
export type RuntimeStartConfig = z.infer<typeof runtimeStartConfigSchema>
export type RuntimeForkConfig = z.infer<typeof runtimeForkConfigSchema>
export type RuntimeForkResult = z.infer<typeof runtimeForkResultSchema>
export type RuntimeImportConfig = z.infer<typeof runtimeImportConfigSchema>
export type RuntimeImportResult = z.infer<typeof runtimeImportResultSchema>
export type SessionExportFormat = z.infer<typeof sessionExportFormatSchema>
export type RuntimeExportConfig = z.infer<typeof runtimeExportConfigSchema>
export type RuntimeExportResult = z.infer<typeof runtimeExportResultSchema>
export type RuntimeNavigateConfig = z.infer<typeof runtimeNavigateConfigSchema>
export type RuntimeNavigateResult = z.infer<typeof runtimeNavigateResultSchema>
export type RuntimeCompactConfig = z.infer<typeof runtimeCompactConfigSchema>
export type RuntimeCompactResult = z.infer<typeof runtimeCompactResultSchema>
export type RuntimeCommand = z.infer<typeof runtimeCommandSchema>
export type RuntimeHostMessage = z.infer<typeof runtimeHostMessageSchema>
