// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { getSecureWebPreferences, isTrustedRendererUrl } from './security.js'

describe('Electron Web Host security adapter', () => {
  it('keeps the BrowserWindow isolated and sandboxed', () => {
    expect(getSecureWebPreferences()).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    })
  })

  it('trusts only the exact loopback Web Host origin', () => {
    const origin = 'http://127.0.0.1:43123'
    expect(isTrustedRendererUrl(`${origin}/settings`, origin)).toBe(true)
    expect(isTrustedRendererUrl('http://127.0.0.1:43124/', origin)).toBe(false)
    expect(isTrustedRendererUrl('http://localhost:43123/', origin)).toBe(false)
    expect(isTrustedRendererUrl('not a URL', origin)).toBe(false)
  })
})
