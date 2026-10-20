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
