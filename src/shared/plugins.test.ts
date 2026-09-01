// @vitest-environment node

import { expect, it } from 'vitest'

import { pluginManifestSchema } from '../plugin/manifest.js'
import { pluginBootstrapEntrySchema } from './plugins.js'

const manifest = pluginManifestSchema.parse({
  id: 'pictor.example',
  name: 'Example',
  version: '0.4.0',
  engines: { pictor: '^0.4.0' },
  dependencies: {},
  modules: { gui: './dist/gui.js' },
})

it('uses an explicit GUI entry in the 0.4 GUI bootstrap', () => {
  expect(
    pluginBootstrapEntrySchema.parse({
      manifest,
      desiredState: 'enabled',
      guiEntryUrl: 'app://bundle/plugins/pictor.example/0.4.0/dist/gui.js',
    }),
  ).toMatchObject({ guiEntryUrl: expect.stringContaining('/dist/gui.js') })
})

it('rejects the removed renderer bootstrap key instead of guessing it', () => {
  expect(() =>
    pluginBootstrapEntrySchema.parse({
      manifest,
      desiredState: 'enabled',
      guiEntryUrl: null,
      rendererEntryUrl: null,
    }),
  ).toThrow()
})
