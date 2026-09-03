import type { ElectronApplication } from '@playwright/test'
import type { ChildProcess } from 'node:child_process'

export type ElectronCloseMode = 'strict' | 'suppress'

export interface CloseElectronAppOptions {
  mode?: ElectronCloseMode
  timeoutMs?: number
  forceKillTimeoutMs?: number
}

const defaultCloseTimeoutMs = 15_000
const defaultForceKillTimeoutMs = 5_000

export async function closeElectronApp(
  app: ElectronApplication,
  {
    mode = 'strict',
    timeoutMs = defaultCloseTimeoutMs,
    forceKillTimeoutMs = defaultForceKillTimeoutMs,
  }: CloseElectronAppOptions = {},
): Promise<void> {
  let closeError: unknown
  try {
    await withTimeout(
      app.close(),
      timeoutMs,
      `Electron did not exit gracefully within ${timeoutMs}ms`,
    )
    return
  } catch (error) {
    closeError = error
  }

  try {
    await forceKillAndWait(app.process(), forceKillTimeoutMs)
  } catch (forceKillError) {
    if (mode === 'strict') {
      const forceError = toError(forceKillError)
      throw new AggregateError(
        [toError(closeError), forceError],
        `Electron cleanup failed: ${forceError.message}`,
        { cause: forceKillError },
      )
    }
    return
  }

  if (mode === 'strict') throw closeError
}

async function forceKillAndWait(process: ChildProcess, timeoutMs: number): Promise<void> {
  if (hasExited(process)) return

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      process.removeListener('exit', handleExit)
      if (error) reject(error)
      else resolve()
    }
    const handleExit = (): void => finish()

    process.once('exit', handleExit)
    const timeout = setTimeout(
      () => finish(new Error(`Electron did not exit within ${timeoutMs}ms after SIGKILL`)),
      timeoutMs,
    )

    if (hasExited(process)) {
      finish()
      return
    }

    try {
      process.kill('SIGKILL')
    } catch (error) {
      if (hasExited(process)) finish()
      else finish(toError(error))
    }
  })
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function hasExited(process: ChildProcess): boolean {
  return process.exitCode !== null || process.signalCode !== null
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
