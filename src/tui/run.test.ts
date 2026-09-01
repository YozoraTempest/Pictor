// @vitest-environment node

import { expect, it, vi } from 'vitest'

import type { ProfileLockConflict } from '../application/index.js'
import { InProcessRuntimeHost } from './runtime-host.js'
import { runTui, TUI_EXIT_CODES, type TuiDependencies } from './run.js'
import type { TuiTerminal } from './contract.js'

class MemoryTerminal implements TuiTerminal {
  columns = 80
  rows = 24
  readonly output: string[] = []

  start(): void {}

  stop(): void {}

  write(value: string): void {
    this.output.push(value)
  }
}

function dependencyFixture(conflict: ProfileLockConflict | null = null): {
  dependencies: TuiDependencies
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  stdout: string[]
  stderr: string[]
} {
  const stdout: string[] = []
  const stderr: string[] = []
  const start = vi.fn(async () => {
    throw new Error('当前 Profile 已被另一个 Frontend 使用')
  })
  const stop = vi.fn(async () => undefined)
  const lock = {
    acquire: async () => null,
    getConflict: () => conflict,
  }
  const runtimeHost = new InProcessRuntimeHost({ emit: () => undefined })
  const dependencies: TuiDependencies = {
    io: {
      stdout: { write: (value) => void stdout.push(value) },
      stderr: { write: (value) => void stderr.push(value) },
    },
    version: '0.4.0',
    resolveUserDataDirectory: (value) => value ?? '/tmp/pictor-tui',
    createProfileLock: () => lock,
    createApplication: async () => ({
      applicationHost: { start, stop },
      runtimeHost,
    }),
    createTerminal: () => new MemoryTerminal(),
  }
  return { dependencies, start, stop, stdout, stderr }
}

it('keeps help/version pure and maps a real Profile conflict to a stable exit code', async () => {
  const help = dependencyFixture()
  await expect(runTui(['--help'], help.dependencies)).resolves.toMatchObject({
    exitCode: TUI_EXIT_CODES.success,
  })
  expect(help.start).not.toHaveBeenCalled()
  expect(help.stdout.join('')).toContain('pictor-tui')

  const conflict: ProfileLockConflict = {
    lockPath: '/tmp/pictor-tui/.pictor-profile.lock',
    owner: {
      schemaVersion: 1,
      token: '11111111-1111-4111-8111-111111111111',
      pid: 123,
      hostname: 'test-host',
      frontend: 'gui',
      profilePath: '/tmp/pictor-tui',
      acquiredAt: '2026-09-02T00:00:00.000Z',
    },
  }
  const locked = dependencyFixture(conflict)
  await expect(
    runTui(['--user-data-dir', '/tmp/pictor-tui'], locked.dependencies),
  ).resolves.toMatchObject({
    exitCode: TUI_EXIT_CODES.profileConflict,
    error: { code: 'profile-locked' },
  })
  expect(locked.stderr.join('')).toContain('Frontend=gui')
  expect(locked.stop).toHaveBeenCalledOnce()
})

it('returns usage exit status without constructing an Application Host for bad arguments', async () => {
  const fixture = dependencyFixture()

  await expect(runTui(['--tui-mode', 'invalid'], fixture.dependencies)).resolves.toMatchObject({
    exitCode: TUI_EXIT_CODES.usage,
    error: { code: 'usage' },
  })
  expect(fixture.start).not.toHaveBeenCalled()
  expect(fixture.stderr.join('')).toContain('tui-mode')
})
