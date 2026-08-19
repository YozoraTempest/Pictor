// @vitest-environment node

import { expect, it } from 'vitest'

import { developmentUserDataPath } from './development-profile.js'

it('isolates normal development from packaged and explicit test data', () => {
  expect(developmentUserDataPath('/config', false, ['electron'])).toBe('/config/pictor-dev')
  expect(developmentUserDataPath('/config', true, ['pictor'])).toBeNull()
  expect(
    developmentUserDataPath('/config', false, ['electron', '--user-data-dir=/tmp/pictor-test']),
  ).toBeNull()
})
