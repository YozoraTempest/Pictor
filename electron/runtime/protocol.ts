import { z } from 'zod'

import { modelSettingsInputSchema, runtimeEventSchema } from '../../src/shared/contracts.js'

export const runtimeStartConfigSchema = z.object({
  type: z.literal('start'),
  runId: z.uuid(),
  sessionId: z.uuid(),
  messageId: z.uuid(),
  projectRoot: z.string().min(1),
  agentDirectory: z.string().min(1),
  sessionDirectory: z.string().min(1),
  settings: modelSettingsInputSchema,
  apiKey: z.string().min(1),
  prompt: z.string().min(1),
})

export const runtimeCommandSchema = z.discriminatedUnion('type', [
  runtimeStartConfigSchema,
  z.object({ type: z.literal('approve'), runId: z.uuid(), callId: z.string().min(1) }),
  z.object({ type: z.literal('reject'), runId: z.uuid(), callId: z.string().min(1) }),
  z.object({ type: z.literal('abort'), runId: z.uuid() }),
  z.object({ type: z.literal('dispose') }),
])

export const runtimeHostMessageSchema = z.union([
  runtimeEventSchema,
  z.object({ type: z.literal('host.ready') }),
  z.object({ type: z.literal('host.fatal'), message: z.string().min(1) }),
])

export type RuntimeStartConfig = z.infer<typeof runtimeStartConfigSchema>
export type RuntimeCommand = z.infer<typeof runtimeCommandSchema>
export type RuntimeHostMessage = z.infer<typeof runtimeHostMessageSchema>
