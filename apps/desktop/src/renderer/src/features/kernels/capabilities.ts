import type { KernelCapabilities, KernelInfo } from '../../../../shared/bridge.js'
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
  model: true,
  skills: true,
  fork: true,
}

export function capabilitiesOf(
  kernels: readonly KernelInfo[],
  kernelId: string | null,
): KernelCapabilities {
  if (kernelId === null) return EVERYTHING
  return kernels.find((kernel) => kernel.id === kernelId)?.capabilities ?? EVERYTHING
}

/** The capabilities of the kernel running `sessionId`, if it is known. */
export function useKernelCapabilities(sessionId: string | null): KernelCapabilities {
  const kernelId = useWorkspaceStore((state) =>
    sessionId === null
      ? null
      : (state.sessions.find((session) => session.id === sessionId)?.kernelId ?? null),
  )
  const kernels = useWorkspaceStore((state) => state.kernels)
  return capabilitiesOf(kernels, kernelId)
}
