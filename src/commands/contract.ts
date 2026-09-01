import { z } from 'zod'

export const commandIdSchema = z.string().trim().min(1).max(200)
export const executionIdSchema = z.uuid()

export const COMMAND_TERMINAL_HISTORY_LIMIT = 64
export const COMMAND_EVENT_HISTORY_LIMIT = 256

export const commandFrontendSchema = z.enum(['gui', 'tui', 'cli', 'shell'])

export const commandContextSchema = z.object({
  frontend: commandFrontendSchema,
  profileId: z.string().trim().min(1).max(200).optional(),
  correlationId: z.uuid().optional(),
})

const commandInputPropertySchema = z.object({
  type: z.enum(['string', 'boolean', 'number', 'object', 'array', 'null']),
  description: z.string().trim().min(1).optional(),
})

export const commandInputSchemaSchema = z.object({
  type: z.enum(['string', 'boolean', 'number', 'object', 'array', 'null']),
  properties: z.record(z.string(), commandInputPropertySchema).optional(),
  required: z.array(z.string()).optional(),
  additionalProperties: z.boolean().optional(),
})

export const commandDescriptorSchema = z.object({
  id: commandIdSchema,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(2_000),
  inputSchema: commandInputSchemaSchema,
  execution: z.object({
    cancellable: z.boolean(),
    recoverySafe: z.boolean(),
  }),
})

export const commandListFilterSchema = z.object({
  query: z.string().trim().max(200).optional(),
  recoverySafe: z.boolean().optional(),
})

export const commandExecutionSchema = z.object({
  executionId: executionIdSchema,
  commandId: commandIdSchema,
})

export const commandCancelResultSchema = z.object({
  executionId: executionIdSchema,
  accepted: z.boolean(),
})

export const commandErrorCodeSchema = z.enum([
  'invalid-input',
  'unknown-command',
  'registry-conflict',
  'not-allowed',
  'execution-not-found',
  'not-cancellable',
  'engine-disposed',
  'handler-failed',
  'invalid-output',
  'cancelled',
])

export const commandErrorSchema = z.object({
  code: commandErrorCodeSchema,
  message: z.string().min(1),
  commandId: commandIdSchema.optional(),
  executionId: executionIdSchema.optional(),
  field: z.string().min(1).optional(),
})

export const commandResultSchema = z.object({
  executionId: executionIdSchema,
  commandId: commandIdSchema,
  value: z.json(),
})

export const commandProgressSchema = z.object({
  message: z.string().trim().min(1).max(2_000),
  percent: z.number().finite().min(0).max(1).nullable().optional(),
})

const commandEventBaseSchema = z.object({
  executionId: executionIdSchema,
  commandId: commandIdSchema,
  at: z.iso.datetime(),
})

export const commandEventSchema = z.discriminatedUnion('type', [
  commandEventBaseSchema.extend({
    type: z.literal('started'),
    sequence: z.literal(0),
    context: commandContextSchema,
  }),
  commandEventBaseSchema.extend({
    type: z.literal('progress'),
    sequence: z.number().int().positive(),
    message: z.string().trim().min(1).max(2_000),
    percent: z.number().finite().min(0).max(1).nullable(),
  }),
  commandEventBaseSchema.extend({
    type: z.literal('output'),
    sequence: z.number().int().positive(),
    value: z.json(),
  }),
  commandEventBaseSchema.extend({
    type: z.literal('completed'),
    sequence: z.number().int().positive(),
    result: commandResultSchema,
  }),
  commandEventBaseSchema.extend({
    type: z.literal('failed'),
    sequence: z.number().int().positive(),
    error: commandErrorSchema,
  }),
  commandEventBaseSchema.extend({
    type: z.literal('cancelled'),
    sequence: z.number().int().positive(),
    reason: z.enum(['requested', 'engine-disposed']),
  }),
])

export const commandExecuteRequestSchema = z.object({
  commandId: commandIdSchema,
  input: z.unknown(),
  context: commandContextSchema,
})

export const commandCancelRequestSchema = z.object({ executionId: executionIdSchema })

export function commandCallResultSchema<T extends z.ZodType>(valueSchema: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value: valueSchema }),
    z.object({ ok: z.literal(false), error: commandErrorSchema }),
  ])
}

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer TValue)[]
    ? readonly DeepReadonly<TValue>[]
    : T extends object
      ? { readonly [TKey in keyof T]: DeepReadonly<T[TKey]> }
      : T

export type CommandId = z.infer<typeof commandIdSchema>
export type ExecutionId = z.infer<typeof executionIdSchema>
export type CommandFrontend = z.infer<typeof commandFrontendSchema>
export type CommandContext = DeepReadonly<z.infer<typeof commandContextSchema>>
export type CommandInputSchema = DeepReadonly<z.infer<typeof commandInputSchemaSchema>>
export type CommandListFilter = DeepReadonly<z.infer<typeof commandListFilterSchema>>
export type CommandDescriptor = DeepReadonly<z.infer<typeof commandDescriptorSchema>>
export type CommandExecution = DeepReadonly<z.infer<typeof commandExecutionSchema>>
export type CommandCancelResult = DeepReadonly<z.infer<typeof commandCancelResultSchema>>
export type CommandErrorCode = z.infer<typeof commandErrorCodeSchema>
export type CommandError = DeepReadonly<z.infer<typeof commandErrorSchema>>
export type CommandResult = DeepReadonly<z.infer<typeof commandResultSchema>>
export type CommandProgress = DeepReadonly<z.infer<typeof commandProgressSchema>>
export type CommandEvent = DeepReadonly<z.infer<typeof commandEventSchema>>

export type CommandEventListener = (event: CommandEvent) => void

export interface CommandClient {
  list(filter?: CommandListFilter): Promise<readonly CommandDescriptor[]>
  execute(commandId: string, input: unknown, context: CommandContext): Promise<CommandExecution>
  cancel(executionId: string): Promise<CommandCancelResult>
  subscribe(executionId: string | undefined, listener: CommandEventListener): () => void
}

export class CommandFailure extends Error {
  readonly name = 'CommandFailure'
  readonly error: CommandError
  readonly code: CommandErrorCode
  readonly commandId?: string
  readonly executionId?: string
  readonly field?: string

  constructor(error: CommandError) {
    super(error.message)
    this.error = freezeCommandValue({ ...error })
    this.code = error.code
    if (error.commandId) this.commandId = error.commandId
    if (error.executionId) this.executionId = error.executionId
    if (error.field) this.field = error.field
    Object.freeze(this)
  }
}

export function toCommandError(
  error: unknown,
  fallback: {
    code: CommandErrorCode
    message: string
    commandId?: string
    executionId?: string
  },
): CommandError {
  if (error instanceof CommandFailure) return error.error
  if (error instanceof z.ZodError) {
    const issue = error.issues[0]
    return {
      code: 'invalid-input',
      message: '命令输入无效',
      ...(fallback.commandId ? { commandId: fallback.commandId } : {}),
      ...(fallback.executionId ? { executionId: fallback.executionId } : {}),
      ...(issue?.path.length ? { field: issue.path.join('.') } : {}),
    }
  }
  return {
    code: fallback.code,
    message: fallback.message,
    ...(fallback.commandId ? { commandId: fallback.commandId } : {}),
    ...(fallback.executionId ? { executionId: fallback.executionId } : {}),
  }
}

export function freezeCommandValue<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      freezeCommandValue(child)
    }
    Object.freeze(value)
  }
  return value
}
