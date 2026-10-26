import type { KernelDriver } from './driver.js'
import type { KernelCommand } from './kinds.js'

/** A kernel with commands of its own. */
export interface KernelCommandSource {
  /** The commands this conversation can run right now. */
  commands(sessionId: string): Promise<KernelCommand[]>
  /**
   * Runs one complete line, leading slash included.
   *
   * Resolves with whatever the kernel wants a person to read (a refusal, a summary),
   * or null when it had nothing to say. The caller does not parse the line: the
   * kernel's own grammar decides what follows the name.
   */
  runCommand(sessionId: string, line: string): Promise<string | null>
}

/** Whether a driver offers commands of its own. */
export function isCommandSource(
  driver: KernelDriver,
): driver is KernelDriver & KernelCommandSource {
  const candidate = driver as Partial<KernelCommandSource>
  return typeof candidate.commands === 'function' && typeof candidate.runCommand === 'function'
}
