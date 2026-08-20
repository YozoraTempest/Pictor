// @vitest-environment node

import { expect, it } from 'vitest'

import { defaultPluginProfile, developerPluginProfile } from './default-profile.js'

it('provides distinct default and Developer Profile identities with the same product roots', () => {
  expect(defaultPluginProfile.id).toBe('pictor.default')
  expect(developerPluginProfile.id).toBe('pictor.developer')
  expect(developerPluginProfile.plugins).toEqual(defaultPluginProfile.plugins)
})
