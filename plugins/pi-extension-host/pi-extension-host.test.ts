// @vitest-environment node

import { readFile } from 'node:fs/promises'

import { expect, it } from 'vitest'

import { pluginManifestSchema } from '@pictor/plugin-sdk/manifest'
import type { ModuleContext } from '@pictor/plugin-sdk/module'
import { piExtensionPathContributions } from '@pictor/plugin-sdk/pi-extension'
import entrypoint from './runtime.js'

it('depends on the native Pi Agent Runtime', async () => {
  const manifest = pluginManifestSchema.parse(
    JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8')),
  )
  expect(manifest.dependencies).toEqual({ 'pictor.pi-agent-runtime': '^0.4.0' })
})

it('contributes installed Extension paths through the portable SDK seam', async () => {
  const contributions = new Map<string, unknown[]>()
  const context: ModuleContext = {
    contribute(point, value) {
      const values = contributions.get(point.id) ?? []
      values.push(value)
      contributions.set(point.id, values)
      return { dispose: () => undefined }
    },
    onDispose: () => undefined,
  }
  const modules = await entrypoint({
    process: 'runtime',
    dataPath: '/plugin-data',
    emit: () => undefined,
    extensions: [{ kind: 'pi-extension', id: 'example.extension', path: '/extensions/example.ts' }],
  })

  await modules[0]?.activate(context)

  expect(contributions.get(piExtensionPathContributions.id)).toEqual(['/extensions/example.ts'])
})
