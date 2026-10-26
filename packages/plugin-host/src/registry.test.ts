import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { discoverPlugins } from './registry.js'

function writePlugin(parent: string, id: string, manifest: Record<string, unknown> = {}): string {
  const root = join(parent, id.replace(/\./g, '-'))
  mkdirSync(root, { recursive: true })
  writeFileSync(
    join(root, 'manifest.json'),
    JSON.stringify({
      id,
      name: id,
      version: '0.0.0',
      main: 'dist/index.js',
      engines: { pictor: '^0.0.0' },
      ...manifest,
    }),
  )
  return root
}

/** A plugin in the npm-package format: `package.json` with a `pictor` field. */
function writePackagePlugin(
  parent: string,
  id: string,
  overrides: Record<string, unknown> = {},
): string {
  const root = join(parent, id.replace(/\./g, '-'))
  mkdirSync(root, { recursive: true })
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      name: `@example/${id}`,
      version: '0.0.0',
      main: 'index.js',
      pictor: { id, engines: { pictor: '^0.0.0' } },
      ...overrides,
    }),
  )
  return root
}

describe('discoverPlugins', () => {
  it('reads valid manifests', () => {
    const parent = mkdtempSync(join(tmpdir(), 'pictor-registry-'))
    const root = writePlugin(parent, 'pictor.hello')

    const discovery = discoverPlugins([root])

    expect(discovery.plugins.map((plugin) => plugin.id)).toEqual(['pictor.hello'])
    expect(discovery.failures).toEqual([])
  })

  it('reports a malformed manifest without throwing', () => {
    const parent = mkdtempSync(join(tmpdir(), 'pictor-registry-'))
    const second = writePlugin(parent, 'pictor.second')
    const root = join(parent, 'broken')
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'manifest.json'), '{ not json')

    const discovery = discoverPlugins([root, second])

    expect(discovery.plugins).toHaveLength(1)
    expect(discovery.failures).toHaveLength(1)
    expect(discovery.failures[0]?.source).toBe(root)
  })

  it('rejects duplicate plugin ids', () => {
    const parent = mkdtempSync(join(tmpdir(), 'pictor-registry-'))
    const first = writePlugin(parent, 'pictor.hello')
    const second = join(parent, 'hello-copy')
    mkdirSync(second, { recursive: true })
    writeFileSync(
      join(second, 'manifest.json'),
      JSON.stringify({
        id: 'pictor.hello',
        name: 'copy',
        version: '0.0.0',
        main: 'dist/index.js',
        engines: { pictor: '^0.0.0' },
      }),
    )

    const discovery = discoverPlugins([first, second])

    expect(discovery.plugins).toHaveLength(1)
    expect(discovery.failures[0]?.reason).toMatch(/duplicate plugin id/)
  })

  it('ignores roots without a manifest', () => {
    const parent = mkdtempSync(join(tmpdir(), 'pictor-registry-'))

    expect(discoverPlugins([parent]).plugins).toEqual([])
  })
})

describe('discoverPlugins across both formats', () => {
  it('reads a plugin from its package.json', () => {
    const parent = mkdtempSync(join(tmpdir(), 'pictor-registry-'))
    const root = writePackagePlugin(parent, 'acme.codex')

    const discovery = discoverPlugins([root])

    expect(discovery.plugins.map((plugin) => plugin.id)).toEqual(['acme.codex'])
    expect(discovery.plugins[0]?.manifestPath.endsWith('package.json')).toBe(true)
    expect(discovery.failures).toEqual([])
  })

  it('still reads a plugin that predates the field', () => {
    const parent = mkdtempSync(join(tmpdir(), 'pictor-registry-'))
    const root = writePlugin(parent, 'pictor.legacy')

    const discovery = discoverPlugins([root])

    expect(discovery.plugins.map((plugin) => plugin.id)).toEqual(['pictor.legacy'])
    expect(discovery.plugins[0]?.manifestPath.endsWith('manifest.json')).toBe(true)
  })

  it('prefers package.json when a root carries both', () => {
    const parent = mkdtempSync(join(tmpdir(), 'pictor-registry-'))
    const root = writePackagePlugin(parent, 'acme.codex')
    writeFileSync(
      join(root, 'manifest.json'),
      JSON.stringify({
        id: 'acme.stale',
        name: 'stale',
        version: '0.0.0',
        main: 'index.js',
        engines: { pictor: '^0.0.0' },
      }),
    )

    // One plugin, one truth: the older file does not get a second say.
    expect(discoverPlugins([root]).plugins.map((plugin) => plugin.id)).toEqual(['acme.codex'])
  })

  it('reports a malformed pictor field instead of falling back', () => {
    const parent = mkdtempSync(join(tmpdir(), 'pictor-registry-'))
    const root = writePackagePlugin(parent, 'acme.codex', { pictor: { id: 'acme.codex' } })

    const discovery = discoverPlugins([root])

    expect(discovery.plugins).toEqual([])
    expect(discovery.failures[0]?.reason).toMatch(/engines/)
  })

  it('leaves a package that never opted in alone', () => {
    const parent = mkdtempSync(join(tmpdir(), 'pictor-registry-'))
    const root = join(parent, 'not-a-plugin')
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0' }))

    const discovery = discoverPlugins([root])

    expect(discovery.plugins).toEqual([])
    expect(discovery.failures).toEqual([])
  })
})
