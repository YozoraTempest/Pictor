import type { ModelEffort } from '@pictor/shared'

import type { KernelModelState } from './kinds.js'
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
export interface KernelModelCatalogue {
  /** The models this kernel offers for one conversation. */
  models(sessionId: string): Promise<KernelModelState>
  /** Switches the conversation to one of them, without a restart. */
  selectModel(sessionId: string, id: string): Promise<void>
  /** Sets the thinking level, or clears it so the kernel's default applies. */
  setEffort(sessionId: string, effort: ModelEffort | null): Promise<void>
}

/** Whether a driver answers for its own models. */
export function isModelSource(driver: KernelDriver): driver is KernelDriver & KernelModelCatalogue {
  const candidate = driver as Partial<KernelModelCatalogue>
  return typeof candidate.models === 'function' && typeof candidate.selectModel === 'function'
}

/**
 * A kernel whose model catalogue can go stale.
 *
 * Pi builds its list once per process and keeps it; a service Pictor adds or edits
 * afterwards is invisible until that process is told to look again. dsh needs none of
 * this — its catalogue is the profile patch it just booted with.
 */
export interface KernelCatalogueSource {
  /** Forgets the cached catalogue; the next read asks the kernel again. */
  invalidateCatalogue(): void
}

/** Whether a driver keeps a catalogue that has to be invalidated. */
export function isCatalogueSource(
  driver: KernelDriver,
): driver is KernelDriver & KernelCatalogueSource {
  return typeof (driver as Partial<KernelCatalogueSource>).invalidateCatalogue === 'function'
}

/**
 * A kernel that asks Pictor to register its services into it.
 * Pi's guard extension asks the loopback bridge for the services to run with, which is
 * how one configuration serves two kernels without a key ever landing on disk. A
 * kernel that is configured at boot — dsh — needs nothing here.
 *
 * `T` is whatever that kernel's own extension understands; the bridge forwards it as
 * JSON, so the app never has to name the shape.
 */
export interface KernelProviderSource<T = unknown> {
  providers(): Promise<T[]>
}

/** Whether a driver takes Pictor's services at runtime rather than at boot. */
export function isProviderSource<T>(
  driver: KernelDriver,
): driver is KernelDriver & KernelProviderSource<T> {
  return typeof (driver as Partial<KernelProviderSource<T>>).providers === 'function'
}
