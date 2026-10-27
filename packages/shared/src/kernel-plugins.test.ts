import { describe, expect, it } from 'vitest'

import {
  enabledKernelPlugins,
  isKernelPluginId,
  kernelPluginIdOf,
  parseKernelPlugins,
} from './kernel-plugins.js'

/**
 * A dsh plugin row is written into the kernel's profile patch, so the parser is the place
 * one bad row becomes either a refused entry or a boot the loader cannot read.
 */
describe('parseKernelPlugins', () => {
  it('keeps a row the patch can mount', () => {
    const [plugin] = parseKernelPlugins([
      {
        id: 'terminal',
        name: '@deepseek-ai/dsh-tool-terminal',
        enabled: true,
        config: { shell: 'bash' },
        source: 'npm',
        version: '0.2.1',
      },
    ])

    expect(plugin).toEqual({
      id: 'terminal',
      name: '@deepseek-ai/dsh-tool-terminal',
      enabled: true,
      config: { shell: 'bash' },
      source: 'npm',
      version: '0.2.1',
    })
  })

  it('names an entry after its package when nobody named one', () => {
    // `insert` needs an id, and a person typing a package name should not have to invent
    // one; the flattening has to survive a scope and dots.
    expect(kernelPluginIdOf('@deepseek-ai/dsh-tool-terminal')).toBe('deepseek-ai-dsh-tool-terminal')
    const [plugin] = parseKernelPlugins([{ name: '@acme/kit' }])
    expect(plugin?.id).toBe('acme-kit')
  })

  it('drops a row that is not a package, and keeps the rest', () => {
    const kept = parseKernelPlugins([
      { name: 'not a package' },
      { name: '../../etc/passwd' },
      { name: 'good-plugin', id: 'good' },
    ])

    expect(kept.map((plugin) => plugin.id)).toEqual(['good'])
  })

  it('drops duplicates and ids the patch already owns', () => {
    const kept = parseKernelPlugins([
      { name: 'first', id: 'same' },
      { name: 'second', id: 'same' },
      // Pictor writes this one itself from the guard endpoint; a second entry with the
      // same id would be a collision on the next boot.
      { name: 'third', id: 'pictor-guard' },
    ])

    expect(kept.map((plugin) => plugin.id)).toEqual(['same'])
  })

  it('drops config that cannot be written into a patch file', () => {
    const circular: Record<string, unknown> = {}
    circular['self'] = circular
    const [plugin] = parseKernelPlugins([{ name: 'acme-kit', config: circular }])

    // A patch is JSON; a config that cannot round-trip would break the whole boot.
    expect(plugin?.config).toBeNull()
  })

  it('reads a missing or malformed list as empty', () => {
    expect(parseKernelPlugins(undefined)).toEqual([])
    expect(parseKernelPlugins('nope')).toEqual([])
    expect(parseKernelPlugins([null, 3])).toEqual([])
  })
})

describe('isKernelPluginId', () => {
  it('accepts ids a patch can quote, and refuses the reserved one', () => {
    expect(isKernelPluginId('terminal')).toBe(true)
    expect(isKernelPluginId('dsh.tool-terminal_2')).toBe(true)
    expect(isKernelPluginId('has space')).toBe(false)
    expect(isKernelPluginId('-leading')).toBe(false)
    expect(isKernelPluginId('pictor-guard')).toBe(false)
  })
})

describe('enabledKernelPlugins', () => {
  it('mounts only what is switched on', () => {
    const plugins = parseKernelPlugins([
      { name: 'on-plugin', enabled: true },
      { name: 'off-plugin', enabled: false },
    ])

    expect(enabledKernelPlugins(plugins).map((plugin) => plugin.name)).toEqual(['on-plugin'])
  })
})
