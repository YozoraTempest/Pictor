// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { pluginManifestSchema } from './manifest.js'
import { pluginProfileSchema, resolvePluginProfile } from './profile.js'

function manifest(id: string, dependencies: Record<string, string> = {}, version = '1.0.0') {
  return pluginManifestSchema.parse({
    id,
    name: id,
    version,
    engines: { pictor: '^0.2.0' },
    dependencies,
    modules: {},
  })
}

describe('Plugin Profile', () => {
  it('expands transitive dependencies in activation order', () => {
    const profile = pluginProfileSchema.parse({
      id: 'pictor.developer',
      plugins: { 'pictor.workspace': '^1.0.0' },
    })

    expect(
      resolvePluginProfile(profile, [
        manifest('pictor.workspace', { 'pictor.runtime': '^1.0.0' }),
        manifest('pictor.runtime', { 'pictor.model': '^1.0.0' }),
        manifest('pictor.model'),
        manifest('pictor.unrelated'),
      ]),
    ).toEqual(['pictor.model', 'pictor.runtime', 'pictor.workspace'])
  })

  it('rejects missing and incompatible roots', () => {
    const missing = pluginProfileSchema.parse({
      id: 'pictor.default',
      plugins: { 'pictor.missing': '^1.0.0' },
    })
    expect(() => resolvePluginProfile(missing, [])).toThrow('requires missing Plugin')

    const incompatible = pluginProfileSchema.parse({
      id: 'pictor.default',
      plugins: { 'pictor.updater': '^2.0.0' },
    })
    expect(() => resolvePluginProfile(incompatible, [manifest('pictor.updater')])).toThrow(
      'bundled version is 1.0.0',
    )
  })
})
