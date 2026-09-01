// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { pluginManifestSchema } from './manifest.js'

describe('Plugin Manifest', () => {
  it('parses Host, GUI, TUI, Runtime modules and native Pi resources', () => {
    expect(
      pluginManifestSchema.parse({
        id: 'pictor.git-changes',
        name: 'Git Changes',
        version: '0.4.0',
        engines: { pictor: '^0.4.0' },
        dependencies: { 'pictor.agent-workspace': '^0.4.0' },
        modules: {
          host: './dist/host.js',
          gui: './dist/gui.js',
          tui: './dist/tui.js',
          runtime: './dist/runtime.js',
        },
        pi: { extensions: ['./pi/extensions'], skills: ['./pi/skills'] },
      }),
    ).toMatchObject({
      id: 'pictor.git-changes',
      version: '0.4.0',
      dependencies: { 'pictor.agent-workspace': '^0.4.0' },
    })
  })

  it('rejects invalid IDs, versions, ranges, and package traversal', () => {
    const base = {
      id: 'pictor.example',
      name: 'Example',
      version: '1.0.0',
      engines: { pictor: '^0.4.0' },
      dependencies: {},
      modules: { host: './dist/host.js' },
    }

    expect(() => pluginManifestSchema.parse({ ...base, id: 'Example' })).toThrow()
    expect(() => pluginManifestSchema.parse({ ...base, version: 'latest' })).toThrow()
    expect(() =>
      pluginManifestSchema.parse({ ...base, dependencies: { 'pictor.core': 'newest' } }),
    ).toThrow()
    expect(() =>
      pluginManifestSchema.parse({ ...base, modules: { host: '../outside.js' } }),
    ).toThrow()
  })

  it('rejects the removed 0.3 Main and Renderer module keys without guessing', () => {
    const manifest = {
      id: 'pictor.legacy',
      name: 'Legacy',
      version: '0.3.0',
      engines: { pictor: '^0.3.0' },
      dependencies: {},
      modules: { main: './dist/main.js', renderer: './dist/renderer.js' },
    }

    expect(() => pluginManifestSchema.parse(manifest)).toThrow()
  })
})
