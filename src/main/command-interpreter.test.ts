// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'

import { discoverCommandInterpreter } from './command-interpreter.js'

describe('command interpreter discovery', () => {
  it('prefers an explicit Linux Bash path', async () => {
    const canExecute = vi.fn(async (path: string) => path === '/custom/bash')

    await expect(
      discoverCommandInterpreter({
        platform: 'linux',
        env: { PICTOR_BASH_PATH: '/custom/bash', PATH: '/usr/local/bin:/usr/bin' },
        canExecute,
      }),
    ).resolves.toEqual({
      executablePath: '/custom/bash',
      status: { kind: 'bash', available: true, message: null },
    })
    expect(canExecute).toHaveBeenCalledWith('/custom/bash')
  })

  it('reports a non-fatal environment warning when Bash is absent', async () => {
    const result = await discoverCommandInterpreter({
      platform: 'linux',
      env: { PATH: '/empty' },
      canExecute: async () => false,
    })

    expect(result.executablePath).toBeNull()
    expect(result.status).toMatchObject({ kind: 'bash', available: false })
    expect(result.status.message).toContain('命令工具不可用')
  })
})
