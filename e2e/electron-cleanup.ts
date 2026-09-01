import type { ElectronApplication } from '@playwright/test'

export type ElectronCloseMode = 'strict' | 'suppress'

export interface CloseElectronAppOptions {
  mode?: ElectronCloseMode
  timeoutMs?: number
}

const defaultCloseTimeoutMs = 5_000

export async function closeElectronApp(
  app: ElectronApplication,
  { mode = 'strict', timeoutMs = defaultCloseTimeoutMs }: CloseElectronAppOptions = {},
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      app.close(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Electron did not exit within ${timeoutMs}ms`)),
          timeoutMs,
        )
      }),
    ])
  } catch (error) {
    try {
      app.process().kill('SIGKILL')
    } catch {
      // Strict mode still reports the original close failure below.
    }
    if (mode === 'strict') return Promise.reject(error)
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
