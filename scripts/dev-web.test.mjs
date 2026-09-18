// @vitest-environment node

import { expect, it } from 'vitest'

import { normalizeDevelopmentArguments } from './dev-web.mjs'

it('uses one stable development port and keeps Web Host arguments', () => {
  expect(normalizeDevelopmentArguments(['--profile', 'developer'])).toEqual({
    forwarded: ['--profile', 'developer', '--port', '4310'],
    port: 4310,
    openBrowser: true,
  })
})

it('preserves an explicit port and consumes supervisor-only flags', () => {
  expect(
    normalizeDevelopmentArguments(['--development', '--no-open', '--port=4910', '--safe-mode']),
  ).toEqual({
    forwarded: ['--port=4910', '--safe-mode'],
    port: 4910,
    openBrowser: false,
  })
})

it('leaves a missing port value for the Web Host parser to reject', () => {
  expect(normalizeDevelopmentArguments(['--port'])).toEqual({
    forwarded: ['--port'],
    port: Number.NaN,
    openBrowser: true,
  })
})
