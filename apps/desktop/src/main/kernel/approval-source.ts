import type { ApprovalMode } from '@pictor/shared'

import type { KernelDriver } from './driver.js'

/**
 * A kernel that lets Pictor decide when a call waits for a person.
 *
 * dsh answers this itself: its sandbox and its approval policy are the runtime's,
 * and an approval arrives as an escalation the runtime started. A kernel without a
 * sandbox has no such policy — but it can hold a call, and then *when* to hold it is
 * a product decision, which is what this seam exposes.
 */
export interface KernelApprovalSource {
  /** The mode this conversation's calls run under. */
  approvalMode(sessionId: string): ApprovalMode
  /** Sets it; a held call is not re-decided, the next one follows the new mode. */
  setApprovalMode(sessionId: string, mode: ApprovalMode): void
}

/** Whether a driver hands its approval decisions to the app. */
export function isApprovalSource(
  driver: KernelDriver,
): driver is KernelDriver & KernelApprovalSource {
  const candidate = driver as Partial<KernelApprovalSource>
  return (
    typeof candidate.approvalMode === 'function' && typeof candidate.setApprovalMode === 'function'
  )
}
