import { moduleHandlerContributions, registerModuleHandlers } from '../../kernel/contract.js'
import { defineModule } from '../../kernel/module.js'
import { ipcResult } from '../../shared/ipc-result.js'
import { appInfoSchema, updaterContract, type AppInfo } from './shared.js'
import { UpdateService, type UpdateServiceOptions } from './update-service.js'

export interface UpdaterMainModuleOptions extends UpdateServiceOptions {
  getAppInfo: () => AppInfo
}

export function createUpdaterMainModule(options: UpdaterMainModuleOptions) {
  return defineModule({
    id: 'updater.main',
    activate(context) {
      const updateService = new UpdateService(options)
      context.contribute(
        moduleHandlerContributions,
        registerModuleHandlers(updaterContract, {
          getAppInfo: async () => appInfoSchema.parse(options.getAppInfo()),
          checkForUpdates: async () => ipcResult(() => updateService.check()),
          openUpdate: async () => ipcResult(() => updateService.openUpdate()),
        }),
      )
    },
  })
}
