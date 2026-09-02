// @vitest-environment node

import { expect, it } from 'vitest'

import { ELECTRON_FUSE_CONFIGURATION, formatFuseState } from './electron-fuses.mjs'

it('keeps every Electron 43 V1 fuse explicit', () => {
  expect(ELECTRON_FUSE_CONFIGURATION).toEqual({
    runAsNode: true,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    loadBrowserProcessSpecificV8Snapshot: false,
    grantFileProtocolExtraPrivileges: false,
  })
})

it('renders the wire states used by structural and fuse smoke evidence', () => {
  expect(formatFuseState(0x31)).toBe('enabled')
  expect(formatFuseState(0x30)).toBe('disabled')
  expect(formatFuseState(0x72)).toBe('removed')
  expect(formatFuseState(0x90)).toBe('inherited')
})
