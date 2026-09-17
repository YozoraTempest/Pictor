import { z } from 'zod'

import { commandEventSchema, executionIdSchema } from '../commands/contract.js'
import { moduleEventEnvelopeSchema } from '../kernel/contract.js'

export const WEB_API_PREFIX = '/api/v1'
export const WEB_EVENT_PATH = `${WEB_API_PREFIX}/events`

export const webClientIdSchema = z.uuid()
export const webConnectionGenerationSchema = z.uuid()

export const webClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('command.replay'),
    executionId: executionIdSchema,
  }),
])

export const webServerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('connection.ready'),
    generation: webConnectionGenerationSchema,
  }),
  z.object({
    type: z.literal('command.event'),
    event: commandEventSchema,
  }),
  z.object({
    type: z.literal('module.event'),
    event: moduleEventEnvelopeSchema,
  }),
  z.object({
    type: z.literal('connection.error'),
    code: z.enum(['invalid-message', 'lease-conflict']),
    message: z.string().min(1),
  }),
])

export type WebClientMessage = z.infer<typeof webClientMessageSchema>
export type WebServerMessage = z.infer<typeof webServerMessageSchema>
