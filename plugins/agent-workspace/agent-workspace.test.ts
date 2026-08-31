// @vitest-environment node

import { readFile } from 'node:fs/promises'

import { expect, it } from 'vitest'

import { pluginManifestSchema } from '../../src/plugin/manifest.js'
import rendererEntrypoint from './renderer.js'

it('ships the Agent Workspace as a Renderer Plugin', async () => {
  const manifest = pluginManifestSchema.parse(
    JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8')),
  )
  expect(manifest).toMatchObject({
    id: 'pictor.agent-workspace',
    version: '0.3.1',
    modules: { main: './dist/main.js', renderer: './dist/renderer.js' },
  })
})

it('delegates Renderer assembly to the Agent Workspace Module', async () => {
  const modules = await rendererEntrypoint({
    process: 'renderer',
    pluginId: 'pictor.agent-workspace',
  })

  expect(modules.map(({ id }) => id)).toEqual(['pictor.agent-workspace.renderer'])
})
