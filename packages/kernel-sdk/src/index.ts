/**
 * What a kernel is, and what it may reach.
 *
 * A kernel ships as its own package: it depends on this one for the contract, on
 * `@pictor/shared` for the vocabulary both sides speak, and on nothing else in this
 * repository. Installed kernels get this module the same way they get cordis — as a
 * dependency — so a package that compiles against it here imports unchanged there.
 */
export type { AgentProbeResult, KernelDriver } from './driver.js'
export {
  KERNEL_PREFIX,
  assertKernelDriver,
  hostService,
  provideKernel,
  type BuiltinKernel,
  type GuardEndpoint,
  type KernelEntry,
  type KernelHostServices,
  type KernelModelService,
  type KernelPlugin,
  type KernelRuleService,
  type KernelSettingsService,
} from './contracts.js'
export {
  isCatalogueSource,
  isModelSource,
  isProviderSource,
  type KernelCatalogueSource,
  type KernelModelCatalogue,
  type KernelProviderSource,
} from './model-source.js'
export {
  isSettingsSource,
  type KernelSetting,
  type KernelSettingsSource,
} from './settings-source.js'
export { isApprovalSource, type KernelApprovalSource } from './approval-source.js'
export { resolveNodeBinary, resolveNpmCli } from './node-runtime.js'
export type {
  HarnessStatus,
  KernelCapabilities,
  KernelInfo,
  KernelModel,
  KernelModelSource,
  KernelModelState,
  PermissionMode,
} from './kinds.js'
