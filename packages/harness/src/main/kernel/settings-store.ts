import type { MetadataStore } from '@vulonlok/host-client'
import type { JsonValue, SettingsMap } from '@vulonlok/shared'

import type { KernelSettingsService } from '@vulonlok/kernel-sdk'

/** The part of the profile store a kernel's settings need. */
export type SettingsSource = Pick<MetadataStore, 'listSettings' | 'putSetting'>

/**
 * The profile's settings, as kernels see them.
 *
 * A kernel reads synchronously — a switch has to answer on the spot — while the store
 * behind it is asynchronous, so this keeps a snapshot. Every write the app does goes
 * through {@link SettingsStore.write}, which keeps that snapshot in step: without it a
 * page could save a value and a kernel would keep reporting the old one until restart.
 */
export interface SettingsStore {
  /** What kernels get as `pictor.settings`. */
  service: KernelSettingsService
  /** Persists one value and updates the snapshot. */
  write(key: string, value: JsonValue): Promise<void>
  /** The snapshot itself, for the settings only the app reads. */
  values(): Readonly<SettingsMap>
}

/** Reads the snapshot once; writes after that keep it current. */
export async function openSettings(store: SettingsSource): Promise<SettingsStore> {
  const snapshot: SettingsMap = { ...(await store.listSettings()) }

  const write = async (key: string, value: JsonValue): Promise<void> => {
    await store.putSetting(key, value)
    snapshot[key] = value
  }

  return {
    service: { read: (key) => snapshot[key], write },
    write,
    values: () => snapshot,
  }
}
