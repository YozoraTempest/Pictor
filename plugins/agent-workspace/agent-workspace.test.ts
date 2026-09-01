// @vitest-environment node

import { readFile } from 'node:fs/promises'

import { expect, it } from 'vitest'

import { pluginManifestSchema } from '../../src/plugin/manifest.js'

it('ships Agent Workspace as a 0.4 Headless Host Plugin', async () => {
  const manifest = pluginManifestSchema.parse(
    JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8')),
  )

  expect(manifest).toMatchObject({
    id: 'pictor.agent-workspace',
    version: '0.4.0',
    engines: { pictor: '^0.4.0' },
    modules: { host: './dist/host.js' },
  })
  expect(manifest.modules).not.toHaveProperty('gui')
})
