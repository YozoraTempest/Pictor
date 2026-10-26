import type { KernelDriver } from './driver.js'

/**
 * A setting one kernel owns, described so the window can draw it.
 *
 * A kernel may have a knob that means nothing to any other kernel — Pi's "run on my
 * own configuration instead of Pictor's" is one. Keeping it here, as data the kernel
 * declares, is what stops the settings page from learning a kernel's name: the page
 * renders whatever it is handed.
 */
export interface KernelSetting {
  /** Storage key, unique across kernels; also what `setKernelSetting` looks up. */
  key: string
  label: string
  description: string
  /** What the current value means, in one line; shown under the switch. */
  hint: () => string
  read: () => boolean
  /**
   * Records the choice.
   *
   * May return a promise: the kernel is also the one that persists the value (through
   * `pictor.settings`), so saving is its business and the caller only waits for it.
   */
  write: (value: boolean) => void | Promise<void>
}

/** A kernel that declares settings of its own. */
export interface KernelSettingsSource {
  settings(): readonly KernelSetting[]
}

/** Whether a driver has settings the window should show. */
export function isSettingsSource(
  driver: KernelDriver,
): driver is KernelDriver & KernelSettingsSource {
  return typeof (driver as Partial<KernelSettingsSource>).settings === 'function'
}
