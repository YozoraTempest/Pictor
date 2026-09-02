// @vitest-environment node

import { readFile } from 'node:fs/promises'

import { expect, it } from 'vitest'

import { pluginManifestSchema } from '@pictor/plugin-sdk/manifest'

it('ships an independent Runtime model Provider', async () => {
  const manifest = pluginManifestSchema.parse(
    JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8')),
  )
  expect(manifest).toMatchObject({
    id: 'pictor.model-openai-compatible',
    modules: { runtime: './dist/runtime.js' },
  })
})
