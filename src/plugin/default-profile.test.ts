// @vitest-environment node

import { expect, it } from 'vitest'

import {
  defaultPluginProfile,
  developerPluginProfile,
  webDeveloperPluginProfile,
  webPluginProfile,
} from './default-profile.js'

it('provides distinct default and Developer Profile identities with the same product roots', () => {
  expect(defaultPluginProfile.id).toBe('pictor.default')
  expect(developerPluginProfile.id).toBe('pictor.developer')
  expect(developerPluginProfile.plugins).toEqual(defaultPluginProfile.plugins)
  expect(Object.keys(defaultPluginProfile.plugins)).toHaveLength(10)
  expect(defaultPluginProfile.plugins['pictor.workbench.delegate']).toBe('^0.4.0')
  expect(defaultPluginProfile.plugins['pictor.tui.delegate']).toBe('^0.4.0')
  expect(defaultPluginProfile.plugins['pictor.gui.plugin-manager']).toBe('^0.4.0')
})

it('omits the desktop Updater from Web-first profiles', () => {
  expect(webPluginProfile.id).toBe('pictor.web')
  expect(webDeveloperPluginProfile.id).toBe('pictor.web-developer')
  expect(webDeveloperPluginProfile.plugins).toEqual(webPluginProfile.plugins)
  expect(webPluginProfile.plugins).not.toHaveProperty('pictor.updater')
  expect(Object.keys(webPluginProfile.plugins)).toHaveLength(9)
})
