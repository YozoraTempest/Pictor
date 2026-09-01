import { z } from 'zod'

import { appInfoSchema, type AppInfo } from './app-info.js'
import { imageAttachmentSchema, type ImageAttachment } from './domain.js'
import { ipcResultSchema, type IpcResult } from './errors.js'
import {
  pluginBootstrapSchema,
  pluginManagerSnapshotSchema,
  type PluginBootstrap,
  type PluginManagerSnapshot,
} from './plugins.js'
import type {
  pluginIdRequestSchema,
  removePluginRequestSchema,
  setPluginEnabledRequestSchema,
} from './plugins.js'

export const packageSpecRequestSchema = z.object({ spec: z.string().trim().min(1).max(2_000) })
export const appInfoResultSchema = ipcResultSchema(appInfoSchema)
export const pluginBootstrapResultSchema = ipcResultSchema(pluginBootstrapSchema)
export const pluginManagerResultSchema = ipcResultSchema(pluginManagerSnapshotSchema)
export const voidResultSchema = ipcResultSchema(z.null())
export const workspaceFilePathResultSchema = ipcResultSchema(z.string().min(1).nullable())
export const sessionExportPickerRequestSchema = z.object({
  format: z.enum(['jsonl', 'html']),
  defaultFileName: z.string().trim().min(1).max(200),
})
export const workspaceImagePickerResultSchema = ipcResultSchema(
  z.array(imageAttachmentSchema).nullable(),
)

export interface PictorBridge {
  notifyRendererReady(): Promise<IpcResult<null>>
  getAppInfo(): Promise<IpcResult<AppInfo>>
  getPluginBootstrap(): Promise<IpcResult<PluginBootstrap>>
  getPluginManagerSnapshot(): Promise<IpcResult<PluginManagerSnapshot>>
  installLocalPlugin(): Promise<IpcResult<PluginManagerSnapshot>>
  installDevelopmentPlugin(): Promise<IpcResult<PluginManagerSnapshot>>
  installPiExtension(): Promise<IpcResult<PluginManagerSnapshot>>
  installPiPackage(): Promise<IpcResult<PluginManagerSnapshot>>
  installPiPackageSpec(
    request: z.infer<typeof packageSpecRequestSchema>,
  ): Promise<IpcResult<PluginManagerSnapshot>>
  pickProjectDirectory(): Promise<IpcResult<string | null>>
  pickSessionImport(): Promise<IpcResult<string | null>>
  pickSessionExport(
    request: z.infer<typeof sessionExportPickerRequestSchema>,
  ): Promise<IpcResult<string | null>>
  pickMessageImages(): Promise<IpcResult<ImageAttachment[] | null>>
  setPluginEnabled(
    request: z.infer<typeof setPluginEnabledRequestSchema>,
  ): Promise<IpcResult<PluginManagerSnapshot>>
  removePlugin(
    request: z.infer<typeof removePluginRequestSchema>,
  ): Promise<IpcResult<PluginManagerSnapshot>>
  restoreBundledPlugin(
    request: z.infer<typeof pluginIdRequestSchema>,
  ): Promise<IpcResult<PluginManagerSnapshot>>
}

export {
  pluginIdRequestSchema,
  removePluginRequestSchema,
  setPluginEnabledRequestSchema,
} from './plugins.js'
export type { IpcResult } from './errors.js'
