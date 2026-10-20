import { describe, expect, it } from 'vitest'

import { ManifestError, parseManifest } from './manifest.js'

const valid = {
  id: 'pictor.hello',
  name: 'Hello',
  version: '0.1.0',
  main: 'dist/index.js',
  engines: { pictor: '^0.0.0' },
}

describe('parseManifest', () => {
  it('accepts a minimal manifest', () => {
    expect(parseManifest(valid)).toMatchObject({
      id: 'pictor.hello',
      name: 'Hello',
      version: '0.1.0',
      main: 'dist/index.js',
    })
  })

  it('accepts dependencies and contributions', () => {
    const manifest = parseManifest({
      ...valid,
      dependencies: { 'pictor.base': '^1.2.3' },
      contributes: [{ point: 'commands', value: { id: 'hello.greet' } }],
    })

    expect(manifest.dependencies).toEqual({ 'pictor.base': '^1.2.3' })
    expect(manifest.contributes).toHaveLength(1)
  })

  it('rejects a malformed id', () => {
    expect(() => parseManifest({ ...valid, id: 'Hello World' })).toThrow(ManifestError)
  })

  it('rejects a non-semver version', () => {
    expect(() => parseManifest({ ...valid, version: '1.0' })).toThrow(/invalid plugin version/)
  })

  it('rejects a main path that escapes the plugin root', () => {
    expect(() => parseManifest({ ...valid, main: '../outside.js' })).toThrow(
      /inside the plugin root/,
    )
  })

  it('requires an engine range', () => {
    expect(() => parseManifest({ ...valid, engines: {} })).toThrow(ManifestError)
  })

  it('rejects non-object dependencies', () => {
    expect(() => parseManifest({ ...valid, dependencies: [] })).toThrow(
      /dependencies must be an object/,
    )
  })
})
