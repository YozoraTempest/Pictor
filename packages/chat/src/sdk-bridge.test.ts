import { afterEach, describe, expect, it } from 'vitest'

import { PI_API_KEY_ENV, withApiKeyEnv } from './sdk-bridge.js'

afterEach(() => {
  delete process.env[PI_API_KEY_ENV]
})

describe('withApiKeyEnv', () => {
  it('sets the key for the call and removes it afterwards', async () => {
    const seen = await withApiKeyEnv('secret-key', async () => process.env[PI_API_KEY_ENV])

    expect(seen).toBe('secret-key')
    expect(process.env[PI_API_KEY_ENV]).toBeUndefined()
  })

  it('re-injects the key for every run', async () => {
    const first = await withApiKeyEnv('secret-key', async () => process.env[PI_API_KEY_ENV])
    const second = await withApiKeyEnv('secret-key', async () => process.env[PI_API_KEY_ENV])

    expect(first).toBe('secret-key')
    expect(second).toBe('secret-key')
  })

  it('does not set an empty key', async () => {
    const seen = await withApiKeyEnv(null, async () => process.env[PI_API_KEY_ENV])
    expect(seen).toBeUndefined()
  })
})
