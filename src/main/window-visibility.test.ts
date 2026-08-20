import { describe, expect, it } from 'vitest'

import { shouldShowMainWindow, shouldShowMainWindowWithoutFocus } from './window-visibility.js'

describe('shouldShowMainWindow', () => {
  it('shows the window during normal development and production execution', () => {
    expect(shouldShowMainWindow({})).toBe(true)
    expect(shouldShowMainWindow({ NODE_ENV: 'production' })).toBe(true)
  })

  it('keeps Electron E2E execution hidden when explicitly requested', () => {
    expect(shouldShowMainWindow({ PICTOR_E2E_HEADLESS: '1' })).toBe(false)
  })
})

describe('shouldShowMainWindowWithoutFocus', () => {
  it('only avoids focus when E2E explicitly requests it', () => {
    expect(shouldShowMainWindowWithoutFocus({})).toBe(false)
    expect(shouldShowMainWindowWithoutFocus({ PICTOR_E2E_NO_FOCUS: '0' })).toBe(false)
    expect(shouldShowMainWindowWithoutFocus({ PICTOR_E2E_NO_FOCUS: '1' })).toBe(true)
  })
})
