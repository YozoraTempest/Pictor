export {
  discoverPlugins,
  expandPluginRoots,
  type DiscoveredPlugin,
  type DiscoveryResult,
  type PluginFailure,
} from './registry.js'

export { resolveActivationOrder, type ResolutionResult } from './resolution.js'

export {
  installPlugin,
  setPluginEnabled,
  uninstallPlugin,
  type InstallOptions,
  type PluginStateStore,
} from './installer.js'

export { PluginHost, type PluginHostOptions, type PluginHostReport } from './host.js'
