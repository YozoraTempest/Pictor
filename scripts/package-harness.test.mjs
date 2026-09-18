import process from 'node:process'

import { describe, expect, it, vi } from 'vitest'

import {
  findPackagedPageTarget,
  stopProcessTree,
  windowsProcessTreeKillArguments,
} from './package-harness.mjs'

describe('package harness', () => {
  it('accepts only the packaged loopback Web Host page target', () => {
    const packagedPage = { type: 'page', url: 'http://127.0.0.1:43123/', title: 'Pictor' }
    expect(
      findPackagedPageTarget([
        { type: 'page', url: 'devtools://devtools/bundled/inspector.html' },
        { type: 'service_worker', url: 'http://127.0.0.1:43123/' },
        packagedPage,
      ]),
    ).toEqual(packagedPage)
    expect(findPackagedPageTarget([{ type: 'page', url: 'http://localhost:43123/' }])).toBeNull()
    expect(findPackagedPageTarget([{ type: 'page', url: 'https://127.0.0.1/' }])).toBeNull()
    expect(
      findPackagedPageTarget([
        {
          type: 'page',
          url: 'http://127.0.0.1:43123/?token=launch-token',
          title: 'Pictor',
        },
      ]),
    ).toBeNull()
    expect(
      findPackagedPageTarget([{ type: 'page', url: 'http://127.0.0.1:43123/', title: '' }]),
    ).toBeNull()
  })

  it('closes the complete Windows launcher process tree', () => {
    expect(windowsProcessTreeKillArguments(4321)).toEqual([
      '/d',
      '/c',
      'taskkill.exe',
      '/PID',
      '4321',
      '/T',
      '/F',
    ])
  })

  it.runIf(process.platform !== 'win32')(
    'waits for the complete POSIX process group after the launcher exits',
    async () => {
      vi.useFakeTimers()
      let processGroupAlive = true
      const kill = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
        if (signal === 0) {
          if (processGroupAlive) return true
          throw Object.assign(new Error('Process group does not exist'), { code: 'ESRCH' })
        }
        if (signal === 'SIGKILL') processGroupAlive = false
        return true
      })

      try {
        const closing = stopProcessTree(
          { pid: 4321, exitCode: null, signalCode: null },
          Promise.resolve({ exitCode: 0, signal: null }),
        )
        await vi.advanceTimersByTimeAsync(5_000)
        await closing

        expect(kill).toHaveBeenCalledWith(-4321, 'SIGTERM')
        expect(kill).toHaveBeenCalledWith(-4321, 'SIGKILL')
      } finally {
        kill.mockRestore()
        vi.useRealTimers()
      }
    },
  )
})
