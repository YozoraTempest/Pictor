// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { pluginManifestSchema } from './manifest.js'

describe('Plugin Manifest', () => {
  it('parses process modules, dependencies, and native Pi resources', () => {
    expect(
      pluginManifestSchema.parse({
        id: 'pictor.git-changes',
        name: 'Git Changes',
        version: '0.3.0',
        engines: { pictor: '^0.3.0' },
        dependencies: { 'pictor.agent-workspace': '^0.3.0' },
        modules: { main: './dist/main.js', renderer: './dist/renderer.js' },
        pi: { extensions: ['./pi/extensions'], skills: ['./pi/skills'] },
      }),
    ).toMatchObject({
      id: 'pictor.git-changes',
      version: '0.3.0',
      dependencies: { 'pictor.agent-workspace': '^0.3.0' },
    })
  })

  it('rejects invalid IDs, versions, ranges, and package traversal', () => {
    const base = {
      id: 'pictor.example',
      name: 'Example',
      version: '1.0.0',
      engines: { pictor: '^0.2.0' },
      dependencies: {},
      modules: { main: './dist/main.js' },
    }

    expect(() => pluginManifestSchema.parse({ ...base, id: 'Example' })).toThrow()
    expect(() => pluginManifestSchema.parse({ ...base, version: 'latest' })).toThrow()
    expect(() =>
      pluginManifestSchema.parse({ ...base, dependencies: { 'pictor.core': 'newest' } }),
    ).toThrow()
    expect(() =>
      pluginManifestSchema.parse({ ...base, modules: { main: '../outside.js' } }),
    ).toThrow()
  })
})
