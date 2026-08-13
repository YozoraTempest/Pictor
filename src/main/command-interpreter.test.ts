// @vitest-environment node

import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { discoverCommandInterpreter } from './command-interpreter.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('command interpreter discovery', () => {
  it('prefers an explicit Linux Bash path', async () => {
    const resolveExecutable = vi.fn(async (path: string) =>
      path === '/custom/bash' ? '/canonical/bash' : null,
    )

    await expect(
      discoverCommandInterpreter({
        platform: 'linux',
        env: { PICTOR_BASH_PATH: '/custom/bash', PATH: '/usr/local/bin:/usr/bin' },
        resolveExecutable,
      }),
    ).resolves.toEqual({
      executablePath: '/canonical/bash',
      status: { kind: 'bash', available: true, message: null },
    })
    expect(resolveExecutable).toHaveBeenCalledWith('/custom/bash')
  })

  it.runIf(process.platform !== 'win32')(
    'resolves a relative override to one canonical executable before runtime handoff',
    async () => {
      const startupDirectory = await mkdtemp(join(tmpdir(), 'pictor-bash-discovery-'))
      roots.push(startupDirectory)
      const toolsDirectory = join(startupDirectory, 'tools')
      const executablePath = join(startupDirectory, 'actual-bash')
      const overridePath = join(toolsDirectory, 'bash')
      await mkdir(toolsDirectory)
      await writeFile(executablePath, '#!/bin/sh\nexit 0\n', 'utf8')
      await chmod(executablePath, 0o700)
      await symlink(executablePath, overridePath)

      const result = await discoverCommandInterpreter({
        platform: 'linux',
        cwd: startupDirectory,
        env: { PICTOR_BASH_PATH: 'tools/bash', PATH: '' },
      })

      expect(result.executablePath).toBe(await realpath(executablePath))
    },
  )

  it('reports a non-fatal environment warning when Bash is absent', async () => {
    const result = await discoverCommandInterpreter({
      platform: 'linux',
      env: { PATH: '/empty' },
      resolveExecutable: async () => null,
    })

    expect(result.executablePath).toBeNull()
    expect(result.status).toMatchObject({ kind: 'bash', available: false })
    expect(result.status.message).toContain('命令工具不可用')
  })
})
