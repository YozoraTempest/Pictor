import { z } from 'zod'

import {
  defineModuleContract,
  invokeModuleMethod,
  type ModuleTransport,
} from '../../kernel/contract.js'
import { appInfoSchema, type AppInfo } from '../../shared/app-info.js'
import { ipcResultSchema, type IpcResult } from '../../shared/errors.js'

export { appInfoSchema }
export type { AppInfo }

export const updateCheckResultSchema = z.object({
  currentVersion: z.string().min(1),
  latestVersion: z.string().min(1),
  updateAvailable: z.boolean(),
  packageAvailable: z.boolean(),
  packageKind: z.enum(['windows-nsis', 'arch-pacman', 'linux-appimage']).nullable(),
  publishedAt: z.iso.datetime().nullable(),
})

export const updaterContract = defineModuleContract({
  id: 'pictor.updater',
  methods: {
    getAppInfo: { input: z.null(), output: appInfoSchema },
    checkForUpdates: { input: z.null(), output: ipcResultSchema(updateCheckResultSchema) },
    openUpdate: { input: z.null(), output: ipcResultSchema(z.null()) },
  },
  events: {},
})

export type UpdateCheckResult = z.infer<typeof updateCheckResultSchema>

export interface UpdaterClient {
  getAppInfo(): Promise<AppInfo>
  checkForUpdates(): Promise<IpcResult<UpdateCheckResult>>
  openUpdate(): Promise<IpcResult<null>>
}

export function createUpdaterClient(transport: ModuleTransport): UpdaterClient {
  return {
    getAppInfo: () => invokeModuleMethod(transport, updaterContract, 'getAppInfo', null),
    checkForUpdates: () => invokeModuleMethod(transport, updaterContract, 'checkForUpdates', null),
    openUpdate: () => invokeModuleMethod(transport, updaterContract, 'openUpdate', null),
  }
}
