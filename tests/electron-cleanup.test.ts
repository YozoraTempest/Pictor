import type { ElectronApplication } from '@playwright/test'

import { closeElectronApp } from '../e2e/electron-cleanup.js'

function fakeElectronApp(close: () => Promise<void>) {
  const kill = vi.fn()
  const app = {
    close: vi.fn(close),
    process: () => ({ kill }),
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

  it('fails in strict mode when it must force terminate Electron', async () => {
    const close = vi.fn(() => new Promise<void>(() => undefined))
    const { app, kill } = fakeElectronApp(close)

    await expect(closeElectronApp(app, { mode: 'strict', timeoutMs: 1 })).rejects.toThrow(
      'Electron did not exit within 1ms',
    )
    expect(kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('suppresses only the cleanup failure in suppress mode', async () => {
    const close = vi.fn(() => new Promise<void>(() => undefined))
    const { app, kill } = fakeElectronApp(close)

    await closeElectronApp(app, { mode: 'suppress', timeoutMs: 1 })

    expect(kill).toHaveBeenCalledWith('SIGKILL')
  })
})
