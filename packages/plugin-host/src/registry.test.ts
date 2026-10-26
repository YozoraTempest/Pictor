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
    const root = writePlugin(parent, 'acme.codex', { pictor: { id: 'acme.codex' } })

    const discovery = discoverPlugins([root])

    expect(discovery.plugins).toEqual([])
    expect(discovery.failures[0]?.reason).toMatch(/engines/)
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
