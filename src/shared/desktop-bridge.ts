import { z } from 'zod'

import { appInfoSchema, type AppInfo } from './app-info.js'
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
