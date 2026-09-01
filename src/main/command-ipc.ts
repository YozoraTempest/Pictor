import { BrowserWindow, ipcMain, type WebFrameMain } from 'electron'
import { z } from 'zod'

import {
  commandCallResultSchema,
  commandCancelRequestSchema,
  commandCancelResultSchema,
  commandDescriptorSchema,
  commandEventSchema,
  commandExecuteRequestSchema,
  commandListFilterSchema,
  type CommandClient,
  toCommandError,
} from '../commands/contract.js'
import type { Disposable } from '../kernel/module.js'

const COMMAND_CHANNELS = ['command:list', 'command:execute', 'command:cancel'] as const
const COMMAND_EVENT_CHANNEL = 'command:event'

export function registerCommandIpc(
  client: CommandClient,
  validateSender: (frame: WebFrameMain | null) => void,
): Disposable {
  const eventSubscription = client.subscribe(undefined, (event) => {
    const payload = commandEventSchema.parse(event)
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(COMMAND_EVENT_CHANNEL, payload)
    }
  })

  ipcMain.handle('command:list', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return commandCallResult(
      () => client.list(commandListFilterSchema.parse(input ?? {})),
      z.array(commandDescriptorSchema),
    )
  })

  ipcMain.handle('command:execute', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return commandCallResult(
      () => {
        const request = commandExecuteRequestSchema.parse(input)
        return client.execute(request.commandId, request.input, request.context)
      },
      z.object({
        executionId: z.uuid(),
        commandId: z.string().min(1),
      }),
    )
  })

  ipcMain.handle('command:cancel', (event, input: unknown) => {
    validateSender(event.senderFrame)
    return commandCallResult(
      () => client.cancel(commandCancelRequestSchema.parse(input).executionId),
      commandCancelResultSchema,
    )
  })

  return {
    dispose: () => {
      eventSubscription()
      for (const channel of COMMAND_CHANNELS) ipcMain.removeHandler(channel)
    },
  }
}

async function commandCallResult<TSchema extends z.ZodType>(
  operation: () => Promise<unknown>,
  valueSchema: TSchema,
): Promise<unknown> {
  try {
    const value = valueSchema.parse(await operation())
    return commandCallResultSchema(valueSchema).parse({ ok: true, value })
  } catch (error) {
    return commandCallResultSchema(valueSchema).parse({
      ok: false,
      error: toCommandError(error, {
        code: 'handler-failed',
        message: '命令请求失败',
      }),
    })
  }
}
