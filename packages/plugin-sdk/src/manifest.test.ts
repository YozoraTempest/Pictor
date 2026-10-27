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

  it('refuses a package that neither opted in nor carries a main', () => {
    // No `pictor` block and no `main` is not a plugin at all — a stray package in the
    // profile must not be reported as broken.
    expect(() => parsePackageManifest({ name: 'x', version: '1.0.0' })).toThrow(/neither/)
  })

  it('reads a cordis plugin, whose needs live in code', () => {
    // The shape dsh ships, and what makes one package installable by both apps: nothing
    // is declared here, so the id is the package name and no engine range is claimed.
    const manifest = parsePackageManifest({
      name: '@acme/cordis-thing',
      version: '1.2.3',
      main: 'index.js',
    })

    expect(manifest.kind).toBe('cordis')
    expect(manifest.id).toBe('@acme/cordis-thing')
    expect(manifest.engines).toBeUndefined()
  })

  it('accepts a pictor block without an engines range, and reports no promise', () => {
    // Engines is a promise to the person installing. Omitting it is allowed; inventing
    // a default would be claiming something the package never said.
    const manifest = parsePackageManifest({ ...pkg, pictor: { id: 'acme.codex' } })

    expect(manifest.kind).toBe('pictor')
    expect(manifest.engines).toBeUndefined()
  })

  it('refuses a main that climbs out of the plugin root', () => {
    expect(() => parsePackageManifest({ ...pkg, main: '../outside.js' })).toThrow(/inside/)
  })

  it('refuses a package version that is not semver', () => {
    expect(() => parsePackageManifest({ ...pkg, version: '1.0' })).toThrow(/invalid plugin version/)
  })
})
