// @vitest-environment node

import { expect, it } from 'vitest'

import { defaultPluginProfile, developerPluginProfile } from './default-profile.js'

it('provides distinct default and Developer Profile identities with the same product roots', () => {
  expect(defaultPluginProfile.id).toBe('pictor.default')
  expect(developerPluginProfile.id).toBe('pictor.developer')
  expect(developerPluginProfile.plugins).toEqual(defaultPluginProfile.plugins)
  expect(Object.keys(defaultPluginProfile.plugins)).toHaveLength(9)
  expect(defaultPluginProfile.plugins['pictor.workbench.delegate']).toBe('^0.4.0')
  expect(defaultPluginProfile.plugins['pictor.gui.plugin-manager']).toBe('^0.4.0')
})
