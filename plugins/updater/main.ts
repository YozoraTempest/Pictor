import { net, shell } from 'electron'

import { pluginEntrypoint, type MainPluginContext } from '../../src/plugin/entry.js'
import { createUpdaterMainModule } from '../../src/modules/updater/main.js'
import { appInfoSchema } from '../../src/modules/updater/shared.js'

export default pluginEntrypoint<MainPluginContext>((context) => {
  const appInfo = appInfoSchema.parse(context.appInfo)
  return [
    createUpdaterMainModule({
      appInfo,
      dataPath: context.dataPath,
      fetch: (input, init) => net.fetch(input instanceof URL ? input.toString() : input, init),
      openExternal: (url) => shell.openExternal(url),
    }),
  ]
})
