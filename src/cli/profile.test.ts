// @vitest-environment node

import { expect, it } from 'vitest'
import { join, resolve } from 'node:path'

import { resolveCliUserDataDirectory } from './profile.js'

it('matches the GUI development user-data defaults and honors explicit paths', () => {
  expect(
    resolveCliUserDataDirectory(null, {
      platform: 'linux',
      homeDirectory: '/home/test',
      environment: {},
    }),
  ).toBe('/home/test/.config/pictor-dev')
  expect(
    resolveCliUserDataDirectory(null, {
      platform: 'linux',
      homeDirectory: '/home/test',
      environment: { XDG_CONFIG_HOME: '/config' },
    }),
  ).toBe('/config/pictor-dev')
  expect(
    resolveCliUserDataDirectory(null, {
      platform: 'win32',
      homeDirectory: 'C:\\Users\\test',
      environment: { APPDATA: '/config' },
    }),
  ).toBe(resolve(join('/config', 'pictor-dev')))
  expect(
    resolveCliUserDataDirectory('./test-user-data', {
      platform: 'linux',
      homeDirectory: '/home/test',
      environment: {},
    }),
  ).toBe(resolve('./test-user-data'))
})
