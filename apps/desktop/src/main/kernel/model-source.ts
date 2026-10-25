import type { ModelEffort } from '@pictor/shared'

import type { KernelModelState } from '../../shared/bridge.js'
import type { KernelDriver } from './driver.js'

/**
 * A kernel that brings its own models.
 *
 * dsh runs whatever Pictor boots it with, so its picker reads Pictor's provider
 * list. A kernel like Pi keeps a catalogue of its own — providers, context windows,
 * which models take images — and only it can answer for it. Declaring that as a
 * separate interface instead of a stub on {@link KernelDriver} keeps a driver from
 * having to implement a method it will never honour.
 */
export interface KernelModelSource {
  /** The models this kernel offers for one conversation. */
  models(sessionId: string): Promise<KernelModelState>
  /** Switches the conversation to one of them, without a restart. */
  selectModel(sessionId: string, id: string): Promise<void>
  /** Sets the thinking level, or clears it so the kernel's default applies. */
  setEffort(sessionId: string, effort: ModelEffort | null): Promise<void>
}

/** Whether a driver answers for its own models. */
export function isModelSource(driver: KernelDriver): driver is KernelDriver & KernelModelSource {
  const candidate = driver as Partial<KernelModelSource>
  return typeof candidate.models === 'function' && typeof candidate.selectModel === 'function'
}
