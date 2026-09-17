import { z } from 'zod'

import {
  COMMAND_EVENT_HISTORY_LIMIT,
  COMMAND_TERMINAL_HISTORY_LIMIT,
  commandCallResultSchema,
  commandCancelResultSchema,
  commandContextSchema,
  commandDescriptorSchema,
  commandEventSchema,
  commandExecuteRequestSchema,
  commandListFilterSchema,
  CommandFailure,
  executionIdSchema,
  freezeCommandValue,
  type CommandClient,
  type CommandContext,
  type CommandError,
  type CommandEvent,
  type CommandEventListener,
  type CommandListFilter,
} from '../commands/contract.js'
import {
  moduleEventEnvelopeSchema,
  moduleInvocationSchema,
  type ModuleTransport,
} from '../kernel/contract.js'
import { ipcResultSchema, PictorError } from '../shared/errors.js'
import {
  WEB_API_PREFIX,
  type WebClientMessage,
  type WebServerMessage,
} from '../shared/web-protocol.js'

export interface WebEventTransport {
  send(message: WebClientMessage): void
  onMessage(listener: (message: WebServerMessage) => void): () => void
}

export interface WebTransports {
  readonly commands: CommandClient
  readonly modules: ModuleTransport
  dispose(): void
}

export type ModuleInvocationOutcome =
  | { readonly status: 'fulfilled'; readonly value: unknown }
  | { readonly status: 'rejected'; readonly error: unknown }

export interface WebTransportOptions {
  readonly onModuleInvocationSettled?: (
    moduleId: string,
    method: string,
    input: unknown,
    outcome: ModuleInvocationOutcome,
  ) => void | Promise<void>
  readonly onHostGenerationChanged?: (previous: string, current: string) => void
}

export function createWebTransports(
  connection: WebEventTransport,
  options: WebTransportOptions = {},
): WebTransports {
  const commandEventHistory = new Map<string, CommandEvent[]>()
  const terminalExecutionIds = new Set<string>()
  const trackedExecutionIds = new Set<string>()
  const pendingCorrelations = new Map<string, number>()
  const pendingExecutionIdsByCorrelation = new Map<string, Set<string>>()
  const commandSubscriptions = new Set<{
    executionId: string | undefined
    listener: CommandEventListener
  }>()
  const moduleSubscriptions = new Set<{
    moduleId: string
    event: string
    listener: (payload: unknown) => void
  }>()
  let hostGeneration: string | null = null

  const releaseConnection = connection.onMessage((message) => {
    if (message.type === 'connection.ready') {
      if (hostGeneration === null) {
        hostGeneration = message.generation
        return
      }
      if (hostGeneration !== message.generation) {
        const previous = hostGeneration
        hostGeneration = message.generation
        commandEventHistory.clear()
        terminalExecutionIds.clear()
        trackedExecutionIds.clear()
        pendingCorrelations.clear()
        pendingExecutionIdsByCorrelation.clear()
        try {
          options.onHostGenerationChanged?.(previous, message.generation)
        } catch {
          // Host generation recovery must not be blocked by diagnostics.
        }
        return
      }
      for (const executionId of trackedExecutionIds) {
        connection.send({ type: 'command.replay', executionId })
      }
      return
    }
    if (message.type === 'command.event') {
      ingestCommandEvent(commandEventSchema.parse(message.event))
      return
    }
    if (message.type === 'module.event') {
      const event = moduleEventEnvelopeSchema.parse(message.event)
      for (const subscription of [...moduleSubscriptions]) {
        if (subscription.moduleId !== event.moduleId || subscription.event !== event.event) continue
        try {
          subscription.listener(event.payload)
        } catch {
          // A GUI listener must not affect transport delivery.
        }
      }
    }
  })

  const commands: CommandClient = Object.freeze({
    list: async (filter: CommandListFilter | undefined) =>
      unwrapCommandCall(
        postJson(`${WEB_API_PREFIX}/commands/list`, commandListFilterSchema.parse(filter ?? {})),
        z.array(commandDescriptorSchema),
      ),
    execute: async (commandId: string, input: unknown, context: CommandContext) => {
      const parsedContext = parseCommandInput(commandContextSchema, context)
      const correlationId = parsedContext.correlationId ?? crypto.randomUUID()
      const request = parseCommandInput(commandExecuteRequestSchema, {
        commandId,
        input,
        context: { ...parsedContext, correlationId },
      })
      beginPendingCorrelation(correlationId)
      let returnedExecutionId: string | undefined
      try {
        const execution = await unwrapCommandCall(
          postJson(`${WEB_API_PREFIX}/commands/execute`, request),
          z.object({ executionId: z.uuid(), commandId: z.string().min(1) }),
        )
        returnedExecutionId = execution.executionId
        trackedExecutionIds.add(execution.executionId)
        return execution
      } finally {
        endPendingCorrelation(correlationId, returnedExecutionId)
        trimTerminalHistory()
      }
    },
    cancel: async (executionId: string) =>
      unwrapCommandCall(
        postJson(`${WEB_API_PREFIX}/commands/cancel`, {
          executionId: parseCommandInput(executionIdSchema, executionId),
        }),
        commandCancelResultSchema,
      ),
    subscribe: (executionId: string | undefined, listener: CommandEventListener) => {
      const parsedExecutionId =
        executionId === undefined ? undefined : parseCommandInput(executionIdSchema, executionId)
      if (parsedExecutionId !== undefined && !trackedExecutionIds.has(parsedExecutionId)) {
        throw new CommandFailure({
          code: 'execution-not-found',
          message: '找不到命令执行',
          executionId: parsedExecutionId,
        })
      }
      const subscription = { executionId: parsedExecutionId, listener }
      commandSubscriptions.add(subscription)
      let released = false
      const release = (): void => {
        if (released) return
        released = true
        commandSubscriptions.delete(subscription)
      }
      if (parsedExecutionId !== undefined) {
        for (const event of [...(commandEventHistory.get(parsedExecutionId) ?? [])]) {
          if (released) break
          notifyCommandListener(listener, event)
        }
      }
      return release
    },
  })

  const modules: ModuleTransport = Object.freeze({
    invoke: async (moduleId: string, method: string, input: unknown) => {
      const invocation = moduleInvocationSchema.parse({ moduleId, method, input })
      try {
        const result = ipcResultSchema(z.unknown()).parse(
          await postJson(`${WEB_API_PREFIX}/modules/invoke`, invocation),
        )
        if (!result.ok) {
          throw new PictorError(result.error.code, result.error.message, result.error.field)
        }
        await notifyModuleInvocationSettled(options, moduleId, method, input, {
          status: 'fulfilled',
          value: result.value,
        })
        return result.value
      } catch (error) {
        await notifyModuleInvocationSettled(options, moduleId, method, input, {
          status: 'rejected',
          error,
        })
        throw error
      }
    },
    onEvent: (moduleId: string, event: string, listener: (payload: unknown) => void) => {
      const subscription = { moduleId, event, listener }
      moduleSubscriptions.add(subscription)
      return () => moduleSubscriptions.delete(subscription)
    },
  })

  function ingestCommandEvent(input: CommandEvent): void {
    const event = freezeCommandValue(input)
    if (event.type === 'started' && event.context.correlationId) {
      addPendingExecution(event.context.correlationId, event.executionId)
    }
    const isOwnedExecution =
      trackedExecutionIds.has(event.executionId) || isPendingExecution(event.executionId)
    if (!isOwnedExecution) {
      notifyCommandSubscribers(event)
      return
    }
    const events = commandEventHistory.get(event.executionId) ?? []
    if (events.some((candidate) => candidate.sequence === event.sequence)) return
    if (isTerminalEvent(events.at(-1))) return
    if (!commandEventHistory.has(event.executionId))
      commandEventHistory.set(event.executionId, events)
    events.push(event)
    events.sort((left, right) => left.sequence - right.sequence)
    trimEventHistory(events)
    if (isTerminalEvent(event)) terminalExecutionIds.add(event.executionId)
    notifyCommandSubscribers(event)
    if (isTerminalEvent(event)) trimTerminalHistory()
  }

  function notifyCommandSubscribers(event: CommandEvent): void {
    for (const subscription of [...commandSubscriptions]) {
      if (
        subscription.executionId !== undefined &&
        subscription.executionId !== event.executionId
      ) {
        continue
      }
      notifyCommandListener(subscription.listener, event)
    }
  }

  function trimTerminalHistory(): void {
    while (terminalExecutionIds.size > COMMAND_TERMINAL_HISTORY_LIMIT) {
      const pendingExecutionIdSet = new Set(
        [...pendingExecutionIdsByCorrelation.values()].flatMap((ids) => [...ids]),
      )
      const executionId = [...terminalExecutionIds].find((id) => !pendingExecutionIdSet.has(id))
      if (!executionId) return
      terminalExecutionIds.delete(executionId)
      commandEventHistory.delete(executionId)
      trackedExecutionIds.delete(executionId)
    }
  }

  function beginPendingCorrelation(correlationId: string): void {
    pendingCorrelations.set(correlationId, (pendingCorrelations.get(correlationId) ?? 0) + 1)
  }

  function endPendingCorrelation(correlationId: string, executionId: string | undefined): void {
    const count = pendingCorrelations.get(correlationId)
    if (count === undefined) return
    if (executionId) {
      const executionIds = pendingExecutionIdsByCorrelation.get(correlationId)
      executionIds?.delete(executionId)
      if (executionIds?.size === 0) pendingExecutionIdsByCorrelation.delete(correlationId)
    }
    if (count > 1) {
      pendingCorrelations.set(correlationId, count - 1)
      return
    }
    pendingCorrelations.delete(correlationId)
    const executionIds = pendingExecutionIdsByCorrelation.get(correlationId)
    if (executionIds) {
      for (const pendingExecutionId of executionIds) trackedExecutionIds.delete(pendingExecutionId)
      pendingExecutionIdsByCorrelation.delete(correlationId)
    }
  }

  function addPendingExecution(correlationId: string, executionId: string): void {
    if (!pendingCorrelations.has(correlationId)) return
    const executionIds = pendingExecutionIdsByCorrelation.get(correlationId) ?? new Set<string>()
    executionIds.add(executionId)
    pendingExecutionIdsByCorrelation.set(correlationId, executionIds)
  }

  function isPendingExecution(executionId: string): boolean {
    return [...pendingExecutionIdsByCorrelation.values()].some((ids) => ids.has(executionId))
  }

  return {
    commands,
    modules,
    dispose: () => {
      releaseConnection()
      commandSubscriptions.clear()
      moduleSubscriptions.clear()
    },
  }
}

async function notifyModuleInvocationSettled(
  options: WebTransportOptions,
  moduleId: string,
  method: string,
  input: unknown,
  outcome: ModuleInvocationOutcome,
): Promise<void> {
  try {
    await options.onModuleInvocationSettled?.(moduleId, method, input, outcome)
  } catch {
    // Transfer cleanup and browser downloads must not change Module results.
  }
}

async function postJson(path: string, input: unknown): Promise<unknown> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) throw new Error(`Web Host request failed: HTTP ${response.status}`)
  return response.json()
}

async function unwrapCommandCall<TSchema extends z.ZodType>(
  resultPromise: Promise<unknown>,
  valueSchema: TSchema,
): Promise<z.output<TSchema>> {
  const result = commandCallResultSchema(valueSchema).parse(await resultPromise) as
    { ok: true; value: z.output<TSchema> } | { ok: false; error: CommandError }
  if (!result.ok) throw new CommandFailure(result.error)
  return freezeCommandValue(result.value)
}

function parseCommandInput<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown,
): z.output<TSchema> {
  try {
    return schema.parse(input)
  } catch (error) {
    const issue = error instanceof z.ZodError ? error.issues[0] : undefined
    throw new CommandFailure({
      code: 'invalid-input',
      message: '命令输入无效',
      ...(issue?.path.length ? { field: issue.path.join('.') } : {}),
    })
  }
}

function notifyCommandListener(listener: CommandEventListener, event: CommandEvent): void {
  try {
    listener(event)
  } catch {
    // A GUI listener must not affect transport delivery.
  }
}

function isTerminalEvent(event: CommandEvent | undefined): boolean {
  return event?.type === 'completed' || event?.type === 'failed' || event?.type === 'cancelled'
}

function trimEventHistory(events: CommandEvent[]): void {
  if (events.length <= COMMAND_EVENT_HISTORY_LIMIT) return
  const started = events[0]
  const tail = events.slice(-(COMMAND_EVENT_HISTORY_LIMIT - 1))
  events.length = 0
  if (started?.type === 'started') events.push(started)
  events.push(...tail)
}
