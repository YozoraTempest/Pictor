// @vitest-environment node

import { readFile } from 'node:fs/promises'

import { expect, it } from 'vitest'

import { pluginManifestSchema } from '../../src/plugin/manifest.js'

it('depends on the native Pi Agent Runtime', async () => {
  const manifest = pluginManifestSchema.parse(
    JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8')),
  )
  expect(manifest.dependencies).toEqual({ 'pictor.pi-agent-runtime': '^0.3.0' })
})
