import { moduleHandlerContributions, registerModuleHandlers } from '../../kernel/contract.js'
import { defineModule } from '../../kernel/module.js'
import { ipcResult } from '../../shared/ipc-result.js'
import { UpdatePreferences } from './preferences.js'
import { appInfoSchema, updaterContract, type AppInfo } from './shared.js'
import { UpdateService, type UpdateServiceOptions } from './update-service.js'

export interface UpdaterMainModuleOptions extends Omit<UpdateServiceOptions, 'appInfo'> {
  appInfo: AppInfo
  dataPath: string
}

export function createUpdaterMainModule(options: UpdaterMainModuleOptions) {
  return defineModule({
    id: 'updater.main',
    activate(context) {
      const appInfo = appInfoSchema.parse(options.appInfo)
      const preferences = new UpdatePreferences(options.dataPath)
      const updateService = new UpdateService({
        appInfo,
        fetch: options.fetch,
        openExternal: options.openExternal,
      })
      const getSnapshot = async () => ({ appInfo, channel: await preferences.getChannel() })
      context.contribute(
        moduleHandlerContributions,
        registerModuleHandlers(updaterContract, {
          getSnapshot,
          setChannel: async ({ channel }) => {
            await preferences.setChannel(channel)
            updateService.reset()
            return getSnapshot()
          },
          checkForUpdates: async () =>
            ipcResult(async () => updateService.check(await preferences.getChannel())),
          openUpdate: async () => ipcResult(() => updateService.openUpdate()),
        }),
      )
    },
  })
}
