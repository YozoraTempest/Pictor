import type {
  KernelCapabilities,
  KernelInfo,
  KernelModelSource,
} from '../../../../shared/bridge.js'
import { useWorkspaceStore } from '../../app/workspace-store.js'

/**
 * What the kernel behind a conversation can do.
 *
 * Every control in the composer is a promise about the kernel: a sandbox picker
 * promises a per-conversation sandbox, a model picker promises the choice reaches
 * the model. A CLI kernel answers neither, and it used to say so only by failing
 * when someone clicked. This is the one place the window asks instead.
 */

/**
 * Everything, for a kernel that has not answered yet.
 *
 * The list arrives with the first snapshot; before that — and for an id this build
 * does not know — hiding controls would be worse than drawing them, because a
 * missing control reads as a broken app rather than as a kernel without that
 * feature.
 */
const EVERYTHING: KernelCapabilities = {
  permission: true,
  approval: true,
  model: true,
  skills: true,
  fork: true,
  commands: true,
}

export function capabilitiesOf(
  kernels: readonly KernelInfo[],
  kernelId: string | null,
): KernelCapabilities {
  if (kernelId === null) return EVERYTHING
  return kernels.find((kernel) => kernel.id === kernelId)?.capabilities ?? EVERYTHING
}

/**
 * Whose model list the composer should offer.
 *
 * Defaulting to Pictor's is the status quo: before the kernel list arrives, the
 * app keeps drawing the picker it always drew rather than nothing at all.
 */
export function modelSourceOf(
  kernels: readonly KernelInfo[],
  kernelId: string | null,
): KernelModelSource {
  if (kernelId === null) return 'pictor'
  return kernels.find((kernel) => kernel.id === kernelId)?.modelSource ?? 'pictor'
}

/** The model source of the kernel running `sessionId`. */
export function useKernelModelSource(sessionId: string | null): KernelModelSource {
  return modelSourceOf(
    useWorkspaceStore((state) => state.kernels),
    useKernelIdOf(sessionId),
  )
}

/** The kernel of one conversation, as the workspace knows it. */
export function useKernelIdOf(sessionId: string | null): string | null {
  return useWorkspaceStore((state) =>
    sessionId === null
      ? null
      : (state.sessions.find((session) => session.id === sessionId)?.kernelId ?? null),
  )
}

/** The capabilities of the kernel running `sessionId`, if it is known. */
export function useKernelCapabilities(sessionId: string | null): KernelCapabilities {
  return capabilitiesOf(
    useWorkspaceStore((state) => state.kernels),
    useKernelIdOf(sessionId),
  )
}
