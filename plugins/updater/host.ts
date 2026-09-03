import { createUpdaterHostModule, type UpdaterHostAdapter } from '../../src/modules/updater/host.js'
import { appInfoSchema } from '../../src/modules/updater/shared.js'
import { pluginEntrypoint, type HostPluginContext } from '@pictor/plugin-sdk/plugin'

export default pluginEntrypoint<HostPluginContext<UpdaterHostAdapter>>((context) => {
  const appInfo = appInfoSchema.parse(context.appInfo)
  return [
    createUpdaterHostModule({
      appInfo,
      dataPath: context.dataPath,
      fetch: context.host.fetch,
      openExternal: context.host.openExternal,
    }),
  ]
})
