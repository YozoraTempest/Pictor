import { BrowserWindow, ipcMain, type WebFrameMain } from 'electron'

import {
  moduleEventEnvelopeSchema,
  moduleInvocationSchema,
  type ModuleRouter,
} from '../kernel/contract.js'
import type { Disposable } from '../kernel/module.js'

const INVOKE_CHANNEL = 'module:invoke'
const EVENT_CHANNEL = 'module:event'

export function registerModuleIpc(
  router: ModuleRouter,
  validateSender: (frame: WebFrameMain | null) => void,
): Disposable {
  ipcMain.handle(INVOKE_CHANNEL, (event, input: unknown) => {
    validateSender(event.senderFrame)
    const invocation = moduleInvocationSchema.parse(input)
    return router.invoke(invocation.moduleId, invocation.method, invocation.input)
  })
  return { dispose: () => ipcMain.removeHandler(INVOKE_CHANNEL) }
}

export function broadcastModuleEvent(input: unknown): void {
  const event = moduleEventEnvelopeSchema.parse(input)
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(EVENT_CHANNEL, event)
}
