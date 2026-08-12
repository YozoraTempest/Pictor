import { describe, expect, it } from 'vitest'

import { shouldShowMainWindow } from './window-visibility.js'

describe('shouldShowMainWindow', () => {
  it('shows the window during normal development and production execution', () => {
    expect(shouldShowMainWindow({})).toBe(true)
    expect(shouldShowMainWindow({ NODE_ENV: 'production' })).toBe(true)
  })

  it('keeps Electron E2E execution hidden when explicitly requested', () => {
    expect(shouldShowMainWindow({ PICTOR_E2E_HEADLESS: '1' })).toBe(false)
  })
})
