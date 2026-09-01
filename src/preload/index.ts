import { contextBridge, ipcRenderer } from 'electron'
import { z } from 'zod'

import {
  commandCallResultSchema,
  commandCancelResultSchema,
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
  packageSpecRequestSchema,
  pluginBootstrapResultSchema,
  pluginIdRequestSchema,
  pluginManagerResultSchema,
  removePluginRequestSchema,
  sessionExportPickerRequestSchema,
  setPluginEnabledRequestSchema,
  voidResultSchema,
  workspaceFilePathResultSchema,
  workspaceImagePickerResultSchema,
  type PictorBridge,
} from '../shared/desktop-bridge.js'

const commandEvents: CommandEvent[] = []
const commandSubscriptions = new Set<{
  executionId: string | undefined
  listener: (event: CommandEvent) => void
}>()

ipcRenderer.on('command:event', (_event, input: unknown) => {
  const event = freezeCommandValue(commandEventSchema.parse(input))
  commandEvents.push(event)
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
})

const commandClient: CommandClient = Object.freeze({
  list: async (filter: CommandListFilter | undefined) =>
    unwrapCommandCall(
      ipcRenderer.invoke('command:list', parseCommandInput(commandListFilterSchema, filter ?? {})),
      z.array(commandDescriptorSchema),
    ),
  execute: async (commandId: string, input: unknown, context: CommandContext) =>
    unwrapCommandCall(
      ipcRenderer.invoke(
        'command:execute',
        parseCommandInput(commandExecuteRequestSchema, { commandId, input, context }),
      ),
      z.object({ executionId: z.uuid(), commandId: z.string().min(1) }),
    ),
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
    const subscription = { executionId: parsedExecutionId, listener }
    commandSubscriptions.add(subscription)
    let released = false
    const release = (): void => {
      if (released) return
      released = true
      commandSubscriptions.delete(subscription)
    }
    if (parsedExecutionId !== undefined) {
      for (const event of commandEvents) {
        if (released) break
        if (event.executionId !== parsedExecutionId) continue
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
  getPluginManagerSnapshot: async () =>
    pluginManagerResultSchema.parse(await ipcRenderer.invoke('plugin:get-manager-snapshot')),
  installLocalPlugin: async () =>
    pluginManagerResultSchema.parse(await ipcRenderer.invoke('plugin:install-local')),
  installPiExtension: async () =>
    pluginManagerResultSchema.parse(await ipcRenderer.invoke('plugin:install-pi-extension')),
  installPiPackage: async () =>
    pluginManagerResultSchema.parse(await ipcRenderer.invoke('plugin:install-pi-package')),
  installDevelopmentPlugin: async () =>
    pluginManagerResultSchema.parse(await ipcRenderer.invoke('plugin:install-development')),
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
  installPiPackageSpec: async (input) =>
    pluginManagerResultSchema.parse(
      await ipcRenderer.invoke(
        'plugin:install-pi-package-spec',
        packageSpecRequestSchema.parse(input),
      ),
    ),
  setPluginEnabled: async (input) =>
    pluginManagerResultSchema.parse(
      await ipcRenderer.invoke('plugin:set-enabled', setPluginEnabledRequestSchema.parse(input)),
    ),
  removePlugin: async (input) =>
    pluginManagerResultSchema.parse(
      await ipcRenderer.invoke('plugin:remove', removePluginRequestSchema.parse(input)),
    ),
  restoreBundledPlugin: async (input) =>
    pluginManagerResultSchema.parse(
      await ipcRenderer.invoke('plugin:restore-bundled', pluginIdRequestSchema.parse(input)),
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
