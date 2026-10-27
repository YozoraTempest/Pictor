import { describe, expect, it } from 'vitest'

import type { McpServerSpec, ModelEffort, ModelEntry } from '@vulonlok/shared'

import { buildProfilePatch } from './harness-profile.js'

const BASE = {
  protocol: 'openai-completions' as const,
  baseUrl: 'http://127.0.0.1:1/v1',
  modelId: 'stub-model',
  // The route builder reads the whole entry: efforts drive `reasoningEfforts`.
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

function server(overrides: Partial<McpServerSpec>): McpServerSpec {
  return {
    name: 'files',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'server'],
    env: {},
    url: '',
    headers: {},
    enabled: true,
    ...overrides,
  }
}

function inserted(patch: string): Array<Record<string, unknown>> {
  return (JSON.parse(patch) as Array<{ insert?: Array<Record<string, unknown>> }>).flatMap(
    (entry) => entry.insert ?? [],
  )
}

describe('buildProfilePatch with MCP servers', () => {
  it('inserts one client instance per stdio server', () => {
    // The MCP client is a namespace plugin: one instance owns one connection and one
    // tool namespace, so several servers are several entries.
    const entries = inserted(buildProfilePatch({ ...BASE, mcp: [server({})] }))

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      id: 'mcp-files',
      name: '@deepseek-ai/dsh-mcp-client',
      config: {
        transport: 'stdio',
        serverName: 'files',
        command: 'npx',
        args: ['-y', 'server'],
        // A server that cannot start must not take the runtime with it.
        failOnStartupError: false,
      },
    })
  })

  it('mounts an http server with its url and headers', () => {
    const entries = inserted(
      buildProfilePatch({
        ...BASE,
        mcp: [
          server({
            name: 'docs',
            transport: 'http',
            command: '',
            url: 'https://example.com/mcp',
            headers: { Authorization: 'Bearer t' },
          }),
        ],
      }),
    )

    expect(entries[0]).toMatchObject({
      id: 'mcp-docs',
      config: {
        transport: 'streamable-http',
        serverName: 'docs',
        url: 'https://example.com/mcp',
        headers: { Authorization: 'Bearer t' },
      },
    })
  })

  it('mounts nothing when the list is empty', () => {
    expect(inserted(buildProfilePatch(BASE))).toEqual([])
  })
})
