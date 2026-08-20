// @vitest-environment node

import { readFile } from 'node:fs/promises'

import { expect, it } from 'vitest'

import { pluginManifestSchema } from '../../src/plugin/manifest.js'

it('ships the Agent Workspace as a Renderer Plugin', async () => {
  const manifest = pluginManifestSchema.parse(
    JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8')),
  )
  expect(manifest).toMatchObject({
    id: 'pictor.agent-workspace',
    modules: { renderer: './dist/renderer.js' },
  })
})
