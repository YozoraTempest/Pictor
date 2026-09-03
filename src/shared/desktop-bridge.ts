import { z } from 'zod'

import type { CommandClient } from '../commands/index.js'
import { appInfoSchema, type AppInfo } from './app-info.js'
import { imageAttachmentSchema, type ImageAttachment } from './domain.js'
import { ipcResultSchema, type IpcResult } from './errors.js'
import { pluginBootstrapSchema, type PluginBootstrap } from './plugins.js'

export const guiPluginSourceSchema = z.enum(['local', 'development', 'pi-extension', 'pi-package'])
export const guiPluginPickerRequestSchema = z.object({ source: guiPluginSourceSchema })
export const guiPluginSelectionSchema = z.object({
  source: guiPluginSourceSchema,
  path: z.string().min(1).nullable(),
})

export type GuiPluginSource = z.infer<typeof guiPluginSourceSchema>
export type GuiPluginSelection = z.infer<typeof guiPluginSelectionSchema>

export interface GuiPluginPicker {
  pickPlugin(source: GuiPluginSource): Promise<IpcResult<GuiPluginSelection>>
}

export const appInfoResultSchema = ipcResultSchema(appInfoSchema)
export const pluginBootstrapResultSchema = ipcResultSchema(pluginBootstrapSchema)
export const guiPluginPickerResultSchema = ipcResultSchema(guiPluginSelectionSchema)
export const voidResultSchema = ipcResultSchema(z.null())
export const workspaceFilePathResultSchema = ipcResultSchema(z.string().min(1).nullable())
export const sessionExportPickerRequestSchema = z.object({
  format: z.enum(['jsonl', 'html']),
  defaultFileName: z.string().trim().min(1).max(200),
})
export const workspaceImagePickerResultSchema = ipcResultSchema(
  z.array(imageAttachmentSchema).nullable(),
)

export interface PictorBridge extends GuiPluginPicker {
  commands: CommandClient
  notifyGuiReady(): Promise<IpcResult<null>>
  getAppInfo(): Promise<IpcResult<AppInfo>>
  getPluginBootstrap(): Promise<IpcResult<PluginBootstrap>>
  pickProjectDirectory(): Promise<IpcResult<string | null>>
  pickSessionImport(): Promise<IpcResult<string | null>>
  pickSessionExport(
    request: z.infer<typeof sessionExportPickerRequestSchema>,
  ): Promise<IpcResult<string | null>>
  pickMessageImages(): Promise<IpcResult<ImageAttachment[] | null>>
}
export type { IpcResult } from './errors.js'
