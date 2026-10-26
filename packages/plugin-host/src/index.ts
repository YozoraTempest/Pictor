export {
  discoverPlugins,
  expandPluginRoots,
  type DiscoveredPlugin,
  type DiscoveryResult,
  type PluginFailure,
} from './registry.js'

export { resolveActivationOrder, type ResolutionResult } from './resolution.js'

export {
  INSTALLED_LIST,
  PluginInstaller,
  type InstalledPlugin,
  type PluginInstallerOptions,
} from './installer.js'

export { PluginHost, type PluginHostOptions, type PluginHostReport } from './host.js'
