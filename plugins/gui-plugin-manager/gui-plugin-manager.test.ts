// @vitest-environment node

import { readFile } from 'node:fs/promises'

import { expect, it } from 'vitest'

import { pluginManifestSchema } from '../../src/plugin/manifest.js'

it('ships a GUI-only Plugin Manager package for Manifest 0.4', async () => {
  const manifest = pluginManifestSchema.parse(
    JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8')),
  )

  expect(manifest).toMatchObject({
    id: 'pictor.gui.plugin-manager',
    version: '0.4.0',
    engines: { pictor: '^0.4.0' },
    modules: { gui: './dist/gui.js' },
  })
  expect(manifest.modules.host).toBeUndefined()
  expect(manifest.modules.runtime).toBeUndefined()
})
