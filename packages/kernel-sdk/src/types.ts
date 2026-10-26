/**
 * The kernel-facing types, and nothing else.
 *
 * The window imports this entry rather than the package root: the contract's runtime
 * half pulls in Node services (the model store, the settings store, node discovery),
 * and the renderer has no business loading any of that. Types erase, so this is the
 * one module that can cross into the renderer without bringing a dependency along.
 */
export type {
  HarnessStatus,
  KernelCommand,
  KernelCapabilities,
  KernelInfo,
  KernelJobOutput,
  KernelModel,
  KernelModelSource,
  KernelModelState,
  PermissionMode,
} from './kinds.js'
