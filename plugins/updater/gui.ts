import { updaterGuiModule } from '../../src/modules/updater/gui.js'
import { pluginEntrypoint, type GuiPluginContext } from '../../src/plugin/entry.js'

export default pluginEntrypoint<GuiPluginContext>(() => [updaterGuiModule])
