import type { ElectronApplication } from '@playwright/test'
import { EventEmitter } from 'node:events'

import { closeElectronApp } from '../e2e/electron-cleanup.js'

function fakeElectronApp(
  close: () => Promise<void>,
  { forceExitDelayMs = 0 }: { forceExitDelayMs?: number | null } = {},
) {
  const process = Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
  })
  const kill = vi.fn((signal: NodeJS.Signals) => {
    if (forceExitDelayMs !== null) {
      setTimeout(() => {
        process.signalCode = signal
        process.emit('exit', null, signal)
      }, forceExitDelayMs)
    }
    return true
  })
  const app = {
    close: vi.fn(close),
    process: () => Object.assign(process, { kill }),
  } as unknown as ElectronApplication
  return { app, kill }
}

describe('closeElectronApp', () => {
  it('uses a normal close without force termination', async () => {
    const close = vi.fn().mockResolvedValue(undefined)
    const { app, kill } = fakeElectronApp(close)

    await closeElectronApp(app)

    expect(close).toHaveBeenCalledOnce()
    expect(kill).not.toHaveBeenCalled()
  })

  it('allows a graceful close that takes longer than five seconds', async () => {
    vi.useFakeTimers()
    try {
      const close = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 6_000)))
      const { app, kill } = fakeElectronApp(close)
      const result = closeElectronApp(app)
      const assertion = expect(result).resolves.toBeUndefined()

      await vi.advanceTimersByTimeAsync(6_000)

      await assertion
      expect(kill).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails in strict mode when it must force terminate Electron', async () => {
    vi.useFakeTimers()
    try {
      const close = vi.fn(() => new Promise<void>(() => undefined))
      const { app, kill } = fakeElectronApp(close)
      const result = closeElectronApp(app, {
        mode: 'strict',
        timeoutMs: 1,
        forceKillTimeoutMs: 10,
      })
      const assertion = expect(result).rejects.toThrow(
        'Electron did not exit gracefully within 1ms',
      )

      await vi.runAllTimersAsync()

      await assertion
      expect(kill).toHaveBeenCalledWith('SIGKILL')
    } finally {
      vi.useRealTimers()
    }
  })

  it('suppresses only the cleanup failure in suppress mode', async () => {
    vi.useFakeTimers()
    try {
      const close = vi.fn(() => new Promise<void>(() => undefined))
      const { app, kill } = fakeElectronApp(close)
      const result = closeElectronApp(app, {
        mode: 'suppress',
        timeoutMs: 1,
        forceKillTimeoutMs: 10,
      })

      await vi.runAllTimersAsync()

      await expect(result).resolves.toBeUndefined()
      expect(kill).toHaveBeenCalledWith('SIGKILL')
    } finally {
      vi.useRealTimers()
    }
  })

  it('waits for the Electron process to exit after force termination', async () => {
    vi.useFakeTimers()
    try {
      const close = vi.fn(() => new Promise<void>(() => undefined))
      const { app, kill } = fakeElectronApp(close, { forceExitDelayMs: 50 })
      let settled = false
      const result = closeElectronApp(app, {
        mode: 'suppress',
        timeoutMs: 1,
        forceKillTimeoutMs: 100,
      }).then(() => {
        settled = true
      })

      await vi.advanceTimersByTimeAsync(1)
      expect(kill).toHaveBeenCalledWith('SIGKILL')
      await vi.advanceTimersByTimeAsync(49)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)

      await result
      expect(settled).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports when Electron remains alive after force termination', async () => {
    vi.useFakeTimers()
    try {
      const close = vi.fn(() => new Promise<void>(() => undefined))
      const { app } = fakeElectronApp(close, { forceExitDelayMs: null })
      const result = closeElectronApp(app, {
        mode: 'strict',
        timeoutMs: 1,
        forceKillTimeoutMs: 10,
      })
      const assertion = expect(result).rejects.toThrow(
        'Electron cleanup failed: Electron did not exit within 10ms after SIGKILL',
      )

      await vi.runAllTimersAsync()

      await assertion
    } finally {
      vi.useRealTimers()
    }
  })
})
