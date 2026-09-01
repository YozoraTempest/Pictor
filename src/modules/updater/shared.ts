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

export const updateChannelSchema = z.enum(['stable', 'nightly'])

export const updaterSnapshotSchema = z.object({
  appInfo: appInfoSchema,
  channel: updateChannelSchema,
})

const updateCheckResultFields = {
  currentVersion: z.string().min(1),
  updateAvailable: z.boolean(),
  packageAvailable: z.boolean(),
  packageKind: z.enum(['windows-nsis', 'arch-pacman', 'linux-appimage']).nullable(),
  publishedAt: z.iso.datetime().nullable(),
}

export const updateCheckResultSchema = z.discriminatedUnion('channel', [
  z.object({
    ...updateCheckResultFields,
    channel: z.literal('stable'),
    latestVersion: z.string().min(1),
    latestCommit: z.null(),
  }),
  z.object({
    ...updateCheckResultFields,
    channel: z.literal('nightly'),
    latestVersion: z.string().min(1).nullable(),
    latestCommit: z.string().regex(/^[0-9a-f]{40}$/),
  }),
])

export const updaterContract = defineModuleContract({
  id: 'pictor.updater',
  methods: {
    getSnapshot: { input: z.null(), output: updaterSnapshotSchema },
    setChannel: {
      input: z.object({ channel: updateChannelSchema }),
      output: updaterSnapshotSchema,
    },
    checkForUpdates: { input: z.null(), output: ipcResultSchema(updateCheckResultSchema) },
    openUpdate: { input: z.null(), output: ipcResultSchema(z.null()) },
  },
  events: {},
})

export type UpdateCheckResult = z.infer<typeof updateCheckResultSchema>
export type UpdateChannel = z.infer<typeof updateChannelSchema>
export type UpdaterSnapshot = z.infer<typeof updaterSnapshotSchema>

export interface UpdaterClient {
  getSnapshot(): Promise<UpdaterSnapshot>
  setChannel(channel: UpdateChannel): Promise<UpdaterSnapshot>
  checkForUpdates(): Promise<IpcResult<UpdateCheckResult>>
  openUpdate(): Promise<IpcResult<null>>
}

export function createUpdaterClient(transport: ModuleTransport): UpdaterClient {
  return {
    getSnapshot: () => invokeModuleMethod(transport, updaterContract, 'getSnapshot', null),
    setChannel: (channel) =>
      invokeModuleMethod(transport, updaterContract, 'setChannel', { channel }),
    checkForUpdates: () => invokeModuleMethod(transport, updaterContract, 'checkForUpdates', null),
    openUpdate: () => invokeModuleMethod(transport, updaterContract, 'openUpdate', null),
  }
}
