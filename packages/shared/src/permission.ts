/**
 * The sandbox mode a conversation starts in, and the check for reading one back.
 *
 * Product vocabulary rather than any one kernel's: the mode is stored in settings, shown
 * in the composer and applied by whichever kernel has a sandbox. A kernel that declares
 * no sandbox simply ignores it, which is why the default lives here and not in dsh.
 */
import type { PermissionMode } from '@vulonlok/kernel-sdk/types'

export const DEFAULT_PERMISSION_MODE: PermissionMode = 'workspace-write'

/** Whether a stored value is one of the modes this build knows. */
export function isPermissionMode(value: unknown): value is PermissionMode {
  return value === 'read-only' || value === 'workspace-write' || value === 'danger-full-access'
}
