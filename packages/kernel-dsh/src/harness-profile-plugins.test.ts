import { describe, expect, it } from 'vitest'

import type { KernelPluginSpec, ModelEffort, ModelEntry } from '@pictor/shared'

import { buildProfilePatch } from './harness-profile.js'

/**
 * Mounting a dsh plugin is one `insert` entry — the same mechanism the MCP client and the
 * guard already use, and the one dsh documents for anything the bundle stack did not
 * declare. What this test pins is that the entry is *plain*: an id, a package name, and
 * the config as given, because the loader resolves the package and reads the config as is.
 */
const BASE = {
  protocol: 'openai-completions' as const,
  baseUrl: 'http://127.0.0.1:1/v1',
  modelId: 'stub-model',
  models: [
    {
      id: 'stub-model',
      name: 'Stub',
      reasoning: true,
      efforts: ['low', 'high'] as ModelEffort[],
      defaultEffort: null,
      input: ['text'] as ModelEntry['input'],
      contextWindow: 1000,
      maxTokens: 100,
    },
  ],
}

function plugin(overrides: Partial<KernelPluginSpec> = {}): KernelPluginSpec {
  return {
    id: 'terminal',
    name: '@deepseek-ai/dsh-tool-terminal',
    config: null,
    enabled: true,
    source: 'npm',
    version: '0.2.1',
    ...overrides,
  }
}

function inserted(patch: string): Array<Record<string, unknown>> {
  return (JSON.parse(patch) as Array<{ insert?: Array<Record<string, unknown>> }>).flatMap(
    (entry) => entry.insert ?? [],
  )
}

describe('buildProfilePatch with dsh plugins', () => {
  it('inserts one entry per plugin, with its id and package name', () => {
    const entries = inserted(buildProfilePatch({ ...BASE, plugins: [plugin()] }))

    expect(entries).toEqual([{ id: 'terminal', name: '@deepseek-ai/dsh-tool-terminal' }])
  })

  it('passes config through untouched', () => {
    // A plugin reads its own config; translating or filtering it here would silently
    // change a plugin's behaviour with no error to point at.
    const entries = inserted(
      buildProfilePatch({
        ...BASE,
        plugins: [plugin({ config: { shell: 'bash', cwd: '/tmp', nested: { deep: [1, 2] } } })],
      }),
    )

    expect(entries[0]?.['config']).toEqual({
      shell: 'bash',
      cwd: '/tmp',
      nested: { deep: [1, 2] },
    })
  })

  it('omits an entry that is switched off', () => {
    const entries = inserted(buildProfilePatch({ ...BASE, plugins: [] }))

    expect(entries).toEqual([])
  })

  it('sits beside the guard and the MCP entries rather than replacing them', () => {
    // One file is written, so an entry that clobbered another would take a working
    // capability with it on the next boot.
    const entries = inserted(
      buildProfilePatch({
        ...BASE,
        plugins: [plugin()],
        guard: { port: 1, token: 't' },
      }),
    )

    expect(entries.map((entry) => entry['id'])).toEqual(['terminal', 'pictor-guard'])
  })
})
