// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { pluginRegistrySchema } from './registry.js'

describe('Plugin Registry', () => {
  it('stores Pictor Plugins, native Pi Extensions, and Pi Packages as first-class entries', () => {
    const registry = pluginRegistrySchema.parse({
      schemaVersion: 1,
      entries: [
        {
          kind: 'pictor-plugin',
          id: 'pictor.updater',
          version: '0.3.0',
          source: { kind: 'bundled', reference: 'pictor.updater' },
          desiredState: 'enabled',
        },
        {
          kind: 'pi-extension',
          id: 'hello-tool',
          source: '/extensions/hello.ts',
          desiredState: 'disabled',
        },
        {
          kind: 'pi-package',
          id: 'example-pi-package',
          source: 'npm:example-pi-package',
          version: '1.2.0',
          desiredState: 'enabled',
        },
      ],
    })

    expect(registry.entries.map((entry) => entry.kind)).toEqual([
      'pictor-plugin',
      'pi-extension',
      'pi-package',
    ])
  })

  it('rejects multiple installed versions of one Plugin ID', () => {
    const entry = {
      kind: 'pictor-plugin',
      id: 'pictor.updater',
      version: '0.3.0',
      source: { kind: 'bundled', reference: 'pictor.updater' },
      desiredState: 'enabled',
    }

    expect(() => pluginRegistrySchema.parse({ schemaVersion: 1, entries: [entry, entry] })).toThrow(
      'Duplicate registry entry',
    )
  })
})
