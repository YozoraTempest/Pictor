// @vitest-environment node

import { readFile } from 'node:fs/promises'

import { expect, it } from 'vitest'

import { pluginManifestSchema } from '../../src/plugin/manifest.js'

it('ships a valid Updater Plugin package', async () => {
  const manifest = pluginManifestSchema.parse(
    JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8')),
  )

  expect(manifest).toMatchObject({
    id: 'pictor.updater',
    modules: { main: './dist/main.js', renderer: './dist/renderer.js' },
  })
})
