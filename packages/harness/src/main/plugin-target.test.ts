import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { declarationOf, manifestAt, targetsOf } from './plugin-target.js'

/**
 * Both sides of Pictor are cordis, so "which kind of plugin is this" is not a taxonomy —
 * it is one fact read from the package's manifest. Getting it wrong sends a package to a
 * tree whose services it cannot see, where it mounts and waits forever with nothing to
 * explain why.
 */
describe('declarationOf', () => {
  it('reads a `pictor` block as the window tree', () => {
    expect(declarationOf({ name: 'acme-kit', pictor: { id: 'acme.kit' } })).toEqual({
      window: true,
      kernel: false,
    })
  })

  it('reads `dsh.bundle` or `dsh.client` as the kernel tree', () => {
    expect(declarationOf({ dsh: { bundle: { patch: './cordis.patch.yml' } } })).toEqual({
      window: false,
      kernel: true,
    })
    // A UI plugin for dsh's own web client declares only a client half.
    expect(declarationOf({ dsh: { client: { platform: 'web' } } })).toEqual({
      window: false,
      kernel: true,
    })
  })

  it('reads both blocks as both trees', () => {
    expect(
      declarationOf({ pictor: { id: 'acme.kit' }, dsh: { bundle: { patch: './p.yml' } } }),
    ).toEqual({ window: true, kernel: true })
  })

  it('reads a dependency on the kernel as the kernel tree', () => {
    // Most dsh plugins are plain cordis plugins: no `dsh` block at all, only peers naming
    // the packages they expect to find in the kernel. That is the signal — and without it
    // a terminal tool would be installed into the window tree and wait forever.
    expect(
      declarationOf({
        name: '@deepseek-ai/dsh-tool-terminal',
        peerDependencies: { '@deepseek-ai/dsh-agent': '*', '@deepseek-ai/cordis': '*' },
      }),
    ).toEqual({ window: false, kernel: true })
  })

  it('takes the installation as the strongest signal, whatever the manifest says', () => {
    expect(declarationOf({ name: 'plain' }, { shipped: true })).toEqual({
      window: false,
      kernel: true,
    })
  })

  it('reads a plain cordis plugin as neither', () => {
    // `name` / `main` only: the window tree already mounts those, so this is not a refusal.
    expect(declarationOf({ name: 'acme-plain', main: 'index.js' })).toEqual({
      window: false,
      kernel: false,
    })
    expect(declarationOf(null)).toEqual({ window: false, kernel: false })
    expect(declarationOf('nope')).toEqual({ window: false, kernel: false })
  })
})

describe('targetsOf', () => {
  it('sends a declared package to what it declares', () => {
    expect(targetsOf({ window: true, kernel: false })).toEqual(['window'])
    expect(targetsOf({ window: false, kernel: true })).toEqual(['kernel'])
    expect(targetsOf({ window: true, kernel: true })).toEqual(['window', 'kernel'])
  })

  it('falls back to the window tree, where a waiting plugin is visible', () => {
    // A plain cordis plugin injecting something this host lacks is reported as skipped by
    // the window tree. In the kernel tree it would take the kernel down instead.
    expect(targetsOf({ window: false, kernel: false })).toEqual(['window'])
  })
})

describe('manifestAt', () => {
  it('reads a manifest, and says nothing rather than throwing', () => {
    const parent = mkdtempSync(join(tmpdir(), 'pictor-target-'))
    try {
      const good = join(parent, 'good')
      mkdirSync(good, { recursive: true })
      writeFileSync(join(good, 'package.json'), JSON.stringify({ name: 'good' }))
      const broken = join(parent, 'broken')
      mkdirSync(broken, { recursive: true })
      writeFileSync(join(broken, 'package.json'), '{ not json')

      expect(manifestAt(good)).toEqual({ name: 'good' })
      expect(manifestAt(broken)).toBeNull()
      expect(manifestAt(join(parent, 'missing'))).toBeNull()
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})
