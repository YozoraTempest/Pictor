import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { addProfileBundle, isBundlePackage, kernelPluginSpec } from './kernel-plugins.js'

/**
 * One fact decides how a dsh plugin mounts: does its manifest declare `dsh.bundle.patch`?
 * A bundle brings its own patch and only needs its name in the profile's bundle list; a
 * plain plugin is inert until an entry names it. Getting this wrong is silent — the package
 * installs, nothing runs, and the page shows a row that claims otherwise.
 */
function packageAt(parent: string, directory: string, manifest: Record<string, unknown>): string {
  const root = join(parent, directory)
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest))
  return root
}

describe('isBundlePackage', () => {
  it('recognises a package that ships its own patch', () => {
    const parent = mkdtempSync(join(tmpdir(), 'pictor-kplugin-'))
    try {
      const bundle = packageAt(parent, 'bundle', {
        name: 'acme-bundle',
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      })
      const plain = packageAt(parent, 'plain', { name: 'acme-plain', main: 'index.js' })

      expect(isBundlePackage(bundle)).toBe(true)
      // A plain cordis plugin is mounted by an entry, not by the bundle list.
      expect(isBundlePackage(plain)).toBe(false)
      // A directory that is not a package is not a bundle either, rather than a throw.
      expect(isBundlePackage(join(parent, 'missing'))).toBe(false)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})

describe('kernelPluginSpec', () => {
  it('accepts the forms the profile can resolve', () => {
    expect(kernelPluginSpec('@deepseek-ai/dsh-tool-terminal')).toEqual({
      spec: '@deepseek-ai/dsh-tool-terminal',
      name: '@deepseek-ai/dsh-tool-terminal',
    })
    expect(kernelPluginSpec('github:acme/kit')).toEqual({ spec: 'github:acme/kit', name: '' })
    expect(kernelPluginSpec('https://example.com/kit.tgz')).toMatchObject({ name: '' })
  })

  it('reads a local package by its own name, not its directory', () => {
    const parent = mkdtempSync(join(tmpdir(), 'pictor-kplugin-'))
    try {
      const root = packageAt(parent, 'checkout', { name: '@acme/kit', version: '2.0.0' })

      // The directory is `checkout`; the package is `@acme/kit`. Using the directory would
      // record a name no profile can resolve.
      expect(kernelPluginSpec(`file:${root}`)).toEqual({
        spec: `file:${root}`,
        name: '@acme/kit',
      })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('refuses what is neither a package nor an address', () => {
    expect(kernelPluginSpec('')).toBeNull()
    expect(kernelPluginSpec('   ')).toBeNull()
    // A bare path is ambiguous with a package name, so it is not guessed at.
    expect(kernelPluginSpec('/home/me/kit')).toBeNull()
    expect(kernelPluginSpec('file:')).toBeNull()
  })
})

describe('addProfileBundle', () => {
  it('adds a bundle once and keeps the rest of the manifest', () => {
    const parent = mkdtempSync(join(tmpdir(), 'pictor-kplugin-'))
    try {
      const profile = packageAt(parent, 'profile', {
        name: 'dsh-profile-pictor',
        private: true,
        dependencies: { '@deepseek-ai/dsh-base': '0.2.1' },
        dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
      })

      addProfileBundle(profile, '@acme/bundle')
      addProfileBundle(profile, '@acme/bundle')

      const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8')) as {
        dependencies: Record<string, string>
        dsh: { profile: { bundles: string[] } }
      }

      expect(manifest.dsh.profile.bundles).toEqual(['@deepseek-ai/dsh-base', '@acme/bundle'])
      expect(manifest.dependencies).toEqual({ '@deepseek-ai/dsh-base': '0.2.1' })
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})
