import { randomUUID } from 'node:crypto'

import { z } from 'zod'

import { ContributionPoint } from '../kernel/module.js'
import {
  commandContextSchema,
  commandCancelResultSchema,
  commandDescriptorSchema,
  commandErrorSchema,
  commandEventSchema,
  commandIdSchema,
  commandListFilterSchema,
  commandProgressSchema,
  commandResultSchema,
  commandExecutionSchema,
  CommandFailure,
  executionIdSchema,
  freezeCommandValue,
  type CommandClient,
  type CommandContext,
  type CommandDescriptor,
  type CommandError,
  type CommandEvent,
  type CommandExecution,
  type CommandId,
} from './contract.js'

export interface CommandHandlerContext {
  readonly executionId: string
  readonly signal: AbortSignal
  readonly commandContext: CommandContext
  reportProgress(progress: unknown): void
  emitOutput(value: unknown): void
}

export interface CommandDefinition<
  TInputSchema extends z.ZodType = z.ZodType,
  TOutputSchema extends z.ZodType = z.ZodType,
> {
  readonly descriptor: CommandDescriptor
  readonly input: TInputSchema
  readonly output: TOutputSchema
  readonly handler: (
    input: z.output<TInputSchema>,
    context: CommandHandlerContext,
  ) => z.input<TOutputSchema> | z.output<TOutputSchema> | Promise<unknown>
  readonly isAllowed?: (context: CommandContext) => boolean
}

export interface CommandContribution {
  readonly owner: string
  readonly commands: readonly CommandDefinition[]
}

export const commandContributions = new ContributionPoint<CommandContribution>(
  'commands.registrations',
)

interface RegisteredCommand {
  readonly owner: string
  readonly definition: CommandDefinition
  readonly descriptor: CommandDescriptor
}

interface ExecutionRecord {
  readonly executionId: string
  readonly commandId: CommandId
  readonly command: RegisteredCommand
  readonly context: CommandContext
  readonly controller: AbortController
  readonly events: CommandEvent[]
  sequence: number
  terminal: boolean
}

interface Subscription {
  readonly executionId: string | undefined
  readonly listener: (event: CommandEvent) => void
}

export class CommandEngine {
  private readonly registry = new Map<string, RegisteredCommand>()
  private readonly coreCommandIds = new Set<string>()
  private readonly executions = new Map<string, ExecutionRecord>()
  private readonly subscriptions = new Set<Subscription>()
  private client: CommandClient | null = null
  private disposed = false

  constructor(coreCommands: readonly CommandDefinition[]) {
    this.registerDefinitions('core', coreCommands, true)
  }

  getClient(): CommandClient {
    if (this.client) return this.client
    const client: CommandClient = {
      list: (filter) => this.list(filter),
      execute: (commandId, input, context) => this.execute(commandId, input, context),
      cancel: (executionId) => this.cancel(executionId),
      subscribe: (executionId, listener) => this.subscribe(executionId, listener),
    }
    this.client = Object.freeze(client)
    return this.client
  }

  registerPluginCommands(owner: string, commands: readonly CommandDefinition[]): void {
    this.ensureActive()
    const normalizedOwner = owner.trim()
    if (!normalizedOwner) {
      throw commandFailure({ code: 'registry-conflict', message: '命令注册需要 Plugin 标识' })
    }
    this.registerDefinitions(normalizedOwner, commands, false)
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    for (const execution of this.executions.values()) {
      if (execution.terminal) continue
      execution.controller.abort()
      this.cancelExecution(execution, 'engine-disposed')
    }
    this.subscriptions.clear()
    this.registry.clear()
    this.coreCommandIds.clear()
  }

  private registerDefinitions(
    owner: string,
    definitions: readonly CommandDefinition[],
    core: boolean,
  ): void {
    const normalizedDefinitions = definitions.map((definition) =>
      this.normalizeDefinition(definition),
    )
    const pendingIds = new Set<string>()
    for (const definition of normalizedDefinitions) {
      const id = definition.descriptor.id
      if (pendingIds.has(id) || this.registry.has(id) || this.coreCommandIds.has(id)) {
        throw commandFailure({
          code: 'registry-conflict',
          message: '命令注册冲突',
          commandId: id,
        })
      }
      if (!core && this.coreCommandIds.has(id)) {
        throw commandFailure({
          code: 'registry-conflict',
          message: 'Plugin 不能覆盖 Core command',
          commandId: id,
        })
      }
      pendingIds.add(id)
    }

    for (const definition of normalizedDefinitions) {
      const id = definition.descriptor.id
      this.registry.set(id, { owner, definition, descriptor: definition.descriptor })
      if (core) this.coreCommandIds.add(id)
    }
  }

  private normalizeDefinition(definition: CommandDefinition): CommandDefinition {
    const descriptor = commandDescriptorSchema.parse(definition.descriptor)
    if (
      definition.input === undefined ||
      definition.output === undefined ||
      typeof definition.handler !== 'function'
    ) {
      throw commandFailure({
        code: 'registry-conflict',
        message: '命令必须声明输入和输出 schema',
        commandId: descriptor.id,
      })
    }
    return { ...definition, descriptor: freezeCommandValue(descriptor) }
  }

  private async list(filter?: unknown): Promise<readonly CommandDescriptor[]> {
    this.ensureActive()
    const parsedFilter = parseOrThrow(commandListFilterSchema, filter ?? {}, '命令列表筛选无效')
    const query = parsedFilter.query?.toLocaleLowerCase()
    const descriptors = [...this.registry.values()]
      .map(({ descriptor }) => descriptor)
      .filter((descriptor) => {
        if (parsedFilter.recoverySafe !== undefined) {
          if (descriptor.execution.recoverySafe !== parsedFilter.recoverySafe) return false
        }
        if (!query) return true
        return `${descriptor.id} ${descriptor.title} ${descriptor.description}`
          .toLocaleLowerCase()
          .includes(query)
      })
    return freezeCommandValue(descriptors.slice()) as readonly CommandDescriptor[]
  }

  private async execute(
    commandId: string,
    input: unknown,
    context: CommandContext,
  ): Promise<CommandExecution> {
    this.ensureActive()
    const parsedCommandId = parseOrThrow(commandIdSchema, commandId, '命令标识无效')
    const command = this.registry.get(parsedCommandId)
    if (!command) {
      throw commandFailure({
        code: 'unknown-command',
        message: '未知命令',
        commandId: parsedCommandId,
      })
    }
    const parsedContext = parseOrThrow(commandContextSchema, context, '调用上下文无效')
    if (command.definition.isAllowed && !command.definition.isAllowed(parsedContext)) {
      throw commandFailure({
        code: 'not-allowed',
        message: '当前调用上下文不能执行此命令',
        commandId: parsedCommandId,
      })
    }
    const parsedInput = parseCommandInput(command.definition.input, input, parsedCommandId)
    const executionId = randomUUID()
    const execution: ExecutionRecord = {
      executionId,
      commandId: parsedCommandId,
      command,
      context: freezeCommandValue(parsedContext),
      controller: new AbortController(),
      events: [],
      sequence: 0,
      terminal: false,
    }
    this.executions.set(executionId, execution)
    this.emit(execution, {
      type: 'started',
      executionId,
      commandId: parsedCommandId,
      sequence: 0,
      at: new Date().toISOString(),
      context: execution.context,
    })
    void this.run(execution, parsedInput)
    return freezeCommandValue(
      commandExecutionSchema.parse({ executionId, commandId: parsedCommandId }),
    )
  }

  private async run(execution: ExecutionRecord, input: unknown): Promise<void> {
    const context: CommandHandlerContext = {
      executionId: execution.executionId,
      signal: execution.controller.signal,
      commandContext: execution.context,
      reportProgress: (progress) => this.reportProgress(execution, progress),
      emitOutput: (value) => this.emitOutput(execution, value),
    }
    try {
      const output = await execution.command.definition.handler(input, context)
      if (execution.terminal) return
      const parsedOutput = parseCommandOutput(
        execution.command.definition.output,
        output,
        execution,
      )
      if (execution.terminal) return
      const result = commandResultSchema.parse({
        executionId: execution.executionId,
        commandId: execution.commandId,
        value: parsedOutput,
      })
      this.completeExecution(execution, result)
    } catch (error) {
      if (execution.terminal) return
      this.failExecution(execution, error)
    }
  }

  private async cancel(executionId: string): Promise<import('./contract.js').CommandCancelResult> {
    this.ensureActive()
    const parsedExecutionId = parseOrThrow(executionIdSchema, executionId, '执行标识无效')
    const execution = this.executions.get(parsedExecutionId)
    if (!execution) {
      throw commandFailure({
        code: 'execution-not-found',
        message: '找不到命令执行',
        executionId: parsedExecutionId,
      })
    }
    if (execution.terminal) {
      return freezeCommandValue(
        commandCancelResultSchema.parse({ executionId: parsedExecutionId, accepted: false }),
      )
    }
    if (!execution.command.descriptor.execution.cancellable) {
      return freezeCommandValue(
        commandCancelResultSchema.parse({ executionId: parsedExecutionId, accepted: false }),
      )
    }
    execution.controller.abort()
    this.cancelExecution(execution, 'requested')
    return freezeCommandValue(
      commandCancelResultSchema.parse({ executionId: parsedExecutionId, accepted: true }),
    )
  }

  private subscribe(
    executionId: string | undefined,
    listener: (event: CommandEvent) => void,
  ): () => void {
    this.ensureActive()
    const parsedExecutionId =
      executionId === undefined
        ? undefined
        : parseOrThrow(executionIdSchema, executionId, '执行标识无效')
    if (parsedExecutionId !== undefined && !this.executions.has(parsedExecutionId)) {
      throw commandFailure({
        code: 'execution-not-found',
        message: '找不到命令执行',
        executionId: parsedExecutionId,
      })
    }
    const subscription: Subscription = { executionId: parsedExecutionId, listener }
    this.subscriptions.add(subscription)
    let released = false
    const release = (): void => {
      if (released) return
      released = true
      this.subscriptions.delete(subscription)
    }
    if (parsedExecutionId !== undefined) {
      const execution = this.executions.get(parsedExecutionId)
      for (const event of execution?.events ?? []) {
        if (released) break
        this.notify(subscription, event)
      }
    }
    return release
  }

  private reportProgress(execution: ExecutionRecord, progress: unknown): void {
    if (execution.terminal) return
    const parsed = parseOrThrow(commandProgressSchema, progress, '命令进度无效')
    this.emit(execution, {
      type: 'progress',
      executionId: execution.executionId,
      commandId: execution.commandId,
      sequence: execution.sequence + 1,
      at: new Date().toISOString(),
      message: parsed.message,
      percent: parsed.percent ?? null,
    })
  }

  private emitOutput(execution: ExecutionRecord, value: unknown): void {
    if (execution.terminal) return
    const parsedOutput = parseCommandOutput(execution.command.definition.output, value, execution)
    this.emit(execution, {
      type: 'output',
      executionId: execution.executionId,
      commandId: execution.commandId,
      sequence: execution.sequence + 1,
      at: new Date().toISOString(),
      value: parsedOutput,
    })
  }

  private completeExecution(
    execution: ExecutionRecord,
    result: import('./contract.js').CommandResult,
  ): void {
    if (execution.terminal) return
    execution.terminal = true
    this.emit(execution, {
      type: 'completed',
      executionId: execution.executionId,
      commandId: execution.commandId,
      sequence: execution.sequence + 1,
      at: new Date().toISOString(),
      result,
    })
  }

  private failExecution(execution: ExecutionRecord, error: unknown): void {
    if (execution.terminal) return
    execution.terminal = true
    const commandError = toExecutionError(error, execution)
    this.emit(execution, {
      type: 'failed',
      executionId: execution.executionId,
      commandId: execution.commandId,
      sequence: execution.sequence + 1,
      at: new Date().toISOString(),
      error: commandError,
    })
  }

  private cancelExecution(
    execution: ExecutionRecord,
    reason: 'requested' | 'engine-disposed',
  ): void {
    if (execution.terminal) return
    execution.terminal = true
    this.emit(execution, {
      type: 'cancelled',
      executionId: execution.executionId,
      commandId: execution.commandId,
      sequence: execution.sequence + 1,
      at: new Date().toISOString(),
      reason,
    })
  }

  private emit(execution: ExecutionRecord, event: unknown): void {
    const parsed = freezeCommandValue(commandEventSchema.parse(event))
    execution.sequence = parsed.sequence
    execution.events.push(parsed)
    for (const subscription of [...this.subscriptions]) {
      if (
        subscription.executionId !== undefined &&
        subscription.executionId !== execution.executionId
      ) {
        continue
      }
      this.notify(subscription, parsed)
    }
  }

  private notify(subscription: Subscription, event: CommandEvent): void {
    try {
      subscription.listener(event)
    } catch {
      // A Frontend listener must not change command execution state.
    }
  }

  private ensureActive(): void {
    if (this.disposed) {
      throw commandFailure({ code: 'engine-disposed', message: 'Command Engine 已释放' })
    }
  }
}

function parseOrThrow<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
  message: string,
): z.output<TSchema> {
  try {
    return schema.parse(value)
  } catch (error) {
    const issue = error instanceof z.ZodError ? error.issues[0] : undefined
    throw commandFailure({
      code: 'invalid-input',
      message,
      ...(issue?.path.length ? { field: issue.path.join('.') } : {}),
    })
  }
}

function parseCommandInput(schema: z.ZodType, input: unknown, commandId: string): unknown {
  try {
    return schema.parse(input)
  } catch (error) {
    const issue = error instanceof z.ZodError ? error.issues[0] : undefined
    throw commandFailure({
      code: 'invalid-input',
      message: '命令输入无效',
      commandId,
      ...(issue?.path.length ? { field: issue.path.join('.') } : {}),
    })
  }
}

function parseCommandOutput(
  schema: z.ZodType,
  output: unknown,
  execution: ExecutionRecord,
): unknown {
  try {
    const parsed = schema.parse(output)
    return z.json().parse(parsed)
  } catch (error) {
    const issue = error instanceof z.ZodError ? error.issues[0] : undefined
    throw commandFailure({
      code: 'invalid-output',
      message: '命令输出无效',
      commandId: execution.commandId,
      executionId: execution.executionId,
      ...(issue?.path.length ? { field: issue.path.join('.') } : {}),
    })
  }
}

function toExecutionError(error: unknown, execution: ExecutionRecord): CommandError {
  if (error instanceof CommandFailure) return error.error
  return {
    code: 'handler-failed',
    message: '命令处理器执行失败',
    commandId: execution.commandId,
    executionId: execution.executionId,
  }
}

function commandFailure(input: {
  code: CommandError['code']
  message: string
  commandId?: string
  executionId?: string
  field?: string
}): CommandFailure {
  const error = commandErrorSchema.parse(input)
  return new CommandFailure(freezeCommandValue(error))
}
