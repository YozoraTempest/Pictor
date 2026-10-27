import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { discoverPlugins, expandPluginRoots } from './registry.js'

/** A plugin directory: a `package.json` that declares `pictor`. */
function writePlugin(parent: string, id: string, overrides: Record<string, unknown> = {}): string {
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
  it('reads a plugin from its package.json', () => {
    const parent = mkdtempSync(join(tmpdir(), 'pictor-registry-'))

    const discovery = discoverPlugins([writePlugin(parent, 'acme.codex')])

    expect(discovery.plugins.map((plugin) => plugin.id)).toEqual(['acme.codex'])
    expect(discovery.failures).toEqual([])
  })

  it('reports a malformed pictor field without throwing', () => {
    const parent = mkdtempSync(join(tmpdir(), 'pictor-registry-'))
    const root = writePlugin(parent, 'acme.codex', { pictor: { id: 'Acme Codex' } })

    const discovery = discoverPlugins([root])

    expect(discovery.plugins).toEqual([])
    expect(discovery.failures[0]?.reason).toMatch(/invalid plugin id/)
  })

  it('accepts a cordis plugin that declares nothing in JSON', () => {
    // The shape dsh ships: no `pictor` block, needs only `main`. That is what makes one
    // package installable by both apps — and what this app must not refuse as malformed.
    const parent = mkdtempSync(join(tmpdir(), 'pictor-registry-'))
    const root = join(parent, 'cordis-thing')
    mkdirSync(root, { recursive: true })
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: '@acme/cordis-thing', version: '1.2.3', main: 'index.js' }),
    )

    const discovery = discoverPlugins([root])

    expect(discovery.failures).toEqual([])
    expect(discovery.plugins[0]?.manifest.kind).toBe('cordis')
    // Its id is the package name: there is nowhere else to put one.
    expect(discovery.plugins[0]?.id).toBe('@acme/cordis-thing')
  })

  it('ignores node_modules when expanding roots', () => {
    // Every dependency has a `main`, so since a cordis plugin needs only that, a
    // directory of them would otherwise be a directory of plugins.
    const parent = mkdtempSync(join(tmpdir(), 'pictor-registry-'))
    const dependency = join(parent, 'node_modules', 'left-pad')
    mkdirSync(dependency, { recursive: true })
    writeFileSync(
      join(dependency, 'package.json'),
      JSON.stringify({ name: 'left-pad', main: 'i.js' }),
    )

    expect(expandPluginRoots([parent])).toEqual([])
  })

  it('rejects duplicate plugin ids', () => {
    const parent = mkdtempSync(join(tmpdir(), 'pictor-registry-'))
    const first = writePlugin(parent, 'acme.codex')
    const second = writePlugin(mkdtempSync(join(tmpdir(), 'pictor-registry-')), 'acme.codex')

    const discovery = discoverPlugins([first, second])

    expect(discovery.plugins).toHaveLength(1)
    expect(discovery.failures[0]?.reason).toMatch(/duplicate/)
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

describe('expandPluginRoots', () => {
  it('offers every directory that carries a package, and nothing else', () => {
    const parent = mkdtempSync(join(tmpdir(), 'pictor-roots-'))
    const plugin = writePlugin(parent, 'acme.codex')
    writeFileSync(join(parent, 'README.md'), 'not a directory')
    mkdirSync(join(parent, 'empty'))

    expect(expandPluginRoots([parent])).toEqual([plugin])
  })

  it('returns nothing for a directory that does not exist', () => {
    expect(expandPluginRoots([join(tmpdir(), 'pictor-nothing-here-9999')])).toEqual([])
  })
})
