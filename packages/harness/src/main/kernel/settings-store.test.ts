import { describe, expect, it } from 'vitest'

import type { JsonValue, SettingsMap } from '@vulonlok/shared'

import { openSettings, type SettingsSource } from './settings-store.js'

/** A store that keeps what it is given, like the profile does. */
function store(initial: SettingsMap = {}): SettingsSource & { written: string[] } {
  const values: SettingsMap = { ...initial }
  const written: string[] = []
  return {
    written,
    listSettings: () => Promise.resolve({ ...values }),
    putSetting: (key: string, value: JsonValue) => {
      written.push(key)
      values[key] = value
      return Promise.resolve()
    },
  }
}

describe('openSettings', () => {
  it('reads what the profile already had', async () => {
    const settings = await openSettings(store({ 'kernel.default': 'pi' }))

    expect(settings.service.read('kernel.default')).toBe('pi')
    expect(settings.service.read('never.set')).toBeUndefined()
  })

  it('shows a write at once, without reading the profile again', async () => {
    // A switch asks the kernel for its state straight after saving it; a snapshot that
    // only refreshed on the next boot would answer with the previous value.
    const source = store()
    const settings = await openSettings(source)

    await settings.write('pi.ownConfig', true)

    expect(settings.service.read('pi.ownConfig')).toBe(true)
    expect(source.written).toEqual(['pi.ownConfig'])
  })

  it('keeps the snapshot in step with writes the page makes on its own', async () => {
    // Both paths go through `write`, which is the point: a setting the app saves for
    // its own reasons must not leave a kernel reading a stale copy.
    const settings = await openSettings(store())

    await settings.service.write('kernel.disabled', ['dsh'])

    expect(settings.service.read('kernel.disabled')).toEqual(['dsh'])
    expect(settings.values()['kernel.disabled']).toEqual(['dsh'])
  })
})
