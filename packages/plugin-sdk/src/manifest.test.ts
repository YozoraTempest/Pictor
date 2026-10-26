import { describe, expect, it } from 'vitest'

import { ManifestError, parseManifest, parsePackageManifest } from './manifest.js'

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

describe('parsePackageManifest', () => {
  const pkg = {
    name: '@acme/pictor-codex',
    version: '1.2.3',
    description: 'Codex as a kernel',
    main: 'index.js',
    pictor: {
      id: 'acme.codex',
      engines: { pictor: '^0.1.0' },
      contributes: [{ point: 'kernel', value: { main: 'kernel.js' } }],
    },
  }

  it('reads the pictor field of a package', () => {
    expect(parsePackageManifest(pkg)).toMatchObject({
      id: 'acme.codex',
      name: '@acme/pictor-codex',
      version: '1.2.3',
      description: 'Codex as a kernel',
      main: 'index.js',
      engines: { pictor: '^0.1.0' },
    })
  })

  it('accepts a package with no UI entry, which only contributes a kernel', () => {
    const headless = { ...pkg } as { main?: string }
    delete headless.main

    expect(parsePackageManifest(headless).main).toBeUndefined()
  })

  it('refuses a package that never opted in', () => {
    expect(() => parsePackageManifest({ name: 'x', version: '1.0.0' })).toThrow(/pictor/)
  })

  it('refuses a missing engines range', () => {
    expect(() => parsePackageManifest({ ...pkg, pictor: { id: 'acme.codex' } })).toThrow(
      /pictor\.engines/,
    )
  })

  it('refuses a main that climbs out of the plugin root', () => {
    expect(() => parsePackageManifest({ ...pkg, main: '../outside.js' })).toThrow(/inside/)
  })

  it('refuses a package version that is not semver', () => {
    expect(() => parsePackageManifest({ ...pkg, version: '1.0' })).toThrow(/invalid plugin version/)
  })
})
