import { contextBridge, ipcRenderer } from 'electron'
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
import {
  appInfoResultSchema,
  guiPluginPickerRequestSchema,
  guiPluginPickerResultSchema,
  pluginBootstrapResultSchema,
  sessionExportPickerRequestSchema,
  voidResultSchema,
  workspaceFilePathResultSchema,
  workspaceImagePickerResultSchema,
  type PictorBridge,
} from '../shared/desktop-bridge.js'

const commandEventHistory = new Map<string, CommandEvent[]>()
const terminalExecutionIds = new Set<string>()
const trackedExecutionIds = new Set<string>()
const pendingCorrelations = new Map<string, number>()
const pendingExecutionIdsByCorrelation = new Map<string, Set<string>>()
const commandSubscriptions = new Set<{
  executionId: string | undefined
  listener: (event: CommandEvent) => void
}>()

ipcRenderer.on('command:event', (_event, input: unknown) => {
  const event = freezeCommandValue(commandEventSchema.parse(input))
  if (event.type === 'started' && event.context.correlationId) {
    addPendingExecution(event.context.correlationId, event.executionId)
  }
  const isOwnedExecution =
    trackedExecutionIds.has(event.executionId) || isPendingExecution(event.executionId)
  if (!isOwnedExecution) {
    notifySubscribers(event)
    return
  }
  const events = commandEventHistory.get(event.executionId) ?? []
  if (isTerminalEvent(events.at(-1))) return
  if (!commandEventHistory.has(event.executionId)) {
    commandEventHistory.set(event.executionId, events)
  }
  events.push(event)
  trimEventHistory(events)
  if (isTerminalEvent(event)) terminalExecutionIds.add(event.executionId)
  notifySubscribers(event)
  if (isTerminalEvent(event)) trimTerminalHistory()
})

function notifySubscribers(event: CommandEvent): void {
  for (const subscription of [...commandSubscriptions]) {
    if (subscription.executionId !== undefined && subscription.executionId !== event.executionId) {
      continue
    }
    try {
      subscription.listener(event)
    } catch {
      // A renderer listener must not affect transport delivery.
    }
  }
}

const commandClient: CommandClient = Object.freeze({
  list: async (filter: CommandListFilter | undefined) =>
    unwrapCommandCall(
      ipcRenderer.invoke('command:list', parseCommandInput(commandListFilterSchema, filter ?? {})),
      z.array(commandDescriptorSchema),
    ),
  execute: async (commandId: string, input: unknown, context: CommandContext) => {
    const parsedContext = parseCommandInput(commandContextSchema, context)
    const correlationId = parsedContext.correlationId ?? globalThis.crypto.randomUUID()
    const request = parseCommandInput(commandExecuteRequestSchema, {
      commandId,
      input,
      context: { ...parsedContext, correlationId },
    })
    beginPendingCorrelation(correlationId)
    let returnedExecutionId: string | undefined
    try {
      const execution = await unwrapCommandCall(
        ipcRenderer.invoke('command:execute', request),
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
      ipcRenderer.invoke('command:cancel', {
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
        try {
          listener(event)
        } catch {
          // A renderer listener must not affect transport delivery.
        }
      }
    }
    return release
  },
})

const bridge = Object.freeze({
  commands: commandClient,
  notifyRendererReady: async () =>
    voidResultSchema.parse(await ipcRenderer.invoke('app:renderer-ready')),
  getAppInfo: async () => appInfoResultSchema.parse(await ipcRenderer.invoke('app:get-info')),
  getPluginBootstrap: async () =>
    pluginBootstrapResultSchema.parse(await ipcRenderer.invoke('plugin:get-bootstrap')),
  pickPlugin: async (source) =>
    guiPluginPickerResultSchema.parse(
      await ipcRenderer.invoke('plugin:pick', guiPluginPickerRequestSchema.parse({ source })),
    ),
  pickProjectDirectory: async () =>
    workspaceFilePathResultSchema.parse(
      await ipcRenderer.invoke('workspace:pick-project-directory'),
    ),
  pickSessionImport: async () =>
    workspaceFilePathResultSchema.parse(await ipcRenderer.invoke('workspace:pick-session-import')),
  pickSessionExport: async (input) =>
    workspaceFilePathResultSchema.parse(
      await ipcRenderer.invoke(
        'workspace:pick-session-export',
        sessionExportPickerRequestSchema.parse(input),
      ),
    ),
  pickMessageImages: async () =>
    workspaceImagePickerResultSchema.parse(
      await ipcRenderer.invoke('workspace:pick-message-images'),
    ),
} satisfies PictorBridge)

const moduleTransport = Object.freeze({
  invoke: async (moduleId, method, input) =>
    ipcRenderer.invoke('module:invoke', moduleInvocationSchema.parse({ moduleId, method, input })),
  onEvent: (moduleId, eventName, listener) => {
    const handler = (_event: Electron.IpcRendererEvent, input: unknown) => {
      const event = moduleEventEnvelopeSchema.parse(input)
      if (event.moduleId === moduleId && event.event === eventName) listener(event.payload)
    }
    ipcRenderer.on('module:event', handler)
    return () => ipcRenderer.removeListener('module:event', handler)
  },
} satisfies ModuleTransport)

contextBridge.exposeInMainWorld('pictor', bridge)
contextBridge.exposeInMainWorld('pictorModules', moduleTransport)

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
    for (const pendingExecutionId of executionIds) {
      trackedExecutionIds.delete(pendingExecutionId)
    }
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
