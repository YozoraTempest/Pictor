import { z } from 'zod'

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

export const reasoningEffortSchema = z
  .enum(['minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
  .nullable()
  .default(null)

export const modelIdSchema = z
  .string()
  .trim()
  .min(1, '请输入模型标识')
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/, '模型标识包含不支持的字符')

export const modelSettingsInputSchema = z.object({
  apiProtocol: apiProtocolSchema,
  baseUrl: baseUrlSchema,
  modelId: modelIdSchema,
  reasoningEffort: reasoningEffortSchema,
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

export const listModelsRequestSchema = z.object({
  baseUrl: baseUrlSchema,
  apiKey: z.string().trim().min(1).max(16_384).optional(),
})

const connectionOutcomeSchema = z.enum([
  'success',
  'authentication',
  'connectivity',
  'model',
  'server',
  'incompatible',
])

export const connectionTestResultSchema = z.object({
  outcome: connectionOutcomeSchema,
  message: z.string().min(1),
})

export const modelCatalogResultSchema = z.object({
  outcome: connectionOutcomeSchema,
  message: z.string().min(1),
  models: z.array(modelIdSchema),
})

export type ModelSettings = z.infer<typeof modelSettingsSchema>
export type ModelSettingsInput = z.infer<typeof modelSettingsInputSchema>
export type SaveSettingsRequest = z.infer<typeof saveSettingsRequestSchema>
export type TestSettingsRequest = z.infer<typeof testSettingsRequestSchema>
export type ConnectionTestResult = z.infer<typeof connectionTestResultSchema>
export type ListModelsRequest = z.infer<typeof listModelsRequestSchema>
export type ModelCatalogResult = z.infer<typeof modelCatalogResultSchema>
