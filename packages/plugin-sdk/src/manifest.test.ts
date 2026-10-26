import { describe, expect, it } from 'vitest'

import { parsePackageManifest } from './manifest.js'

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
