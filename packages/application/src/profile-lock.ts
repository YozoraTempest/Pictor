import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs'

export interface ProfileLockOptions {
  path: string
  /** Written into the lock file so a stale owner can be diagnosed. */
  owner: string
  /** Fail instead of waiting when the lock is held. */
  nowait?: boolean
  timeoutMs?: number
  pollIntervalMs?: number
}

export class ProfileLockedError extends Error {
  readonly owner: string

  constructor(owner: string) {
    super(`profile is locked by another frontend (${owner})`)
    this.name = 'ProfileLockedError'
    this.owner = owner
  }
}

export interface ProfileLock {
  readonly path: string
  release(): void
}

/**
 * One writer per profile.
 *
 * `O_EXCL` makes acquisition atomic across processes. Waiting is asynchronous
 * on purpose: the Electron main process shares this event loop with the window,
 * so a blocking poll would freeze the UI.
 */
export async function acquireProfileLock(options: ProfileLockOptions): Promise<ProfileLock> {
  const timeoutMs = options.timeoutMs ?? 0
  const pollIntervalMs = options.pollIntervalMs ?? 100
  const deadline = Date.now() + timeoutMs

  for (;;) {
    try {
      const descriptor = openSync(options.path, 'wx')
      writeSync(descriptor, options.owner)
      closeSync(descriptor)

      return {
        path: options.path,
        release(): void {
          try {
            unlinkSync(options.path)
          } catch {
            // Already removed; releasing is idempotent.
          }
        },
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error

      const owner = readOwner(options.path)
      if (isStale(owner)) {
        try {
          unlinkSync(options.path)
        } catch {
          // Another process may have won the race; retry.
        }
        continue
      }

      if (options.nowait === true || Date.now() >= deadline) {
        throw new ProfileLockedError(owner ?? 'unknown')
      }

      await sleep(pollIntervalMs)
    }
  }
}

function readOwner(path: string): string | null {
  try {
    return readFileSync(path, 'utf8').trim()
  } catch {
    return null
  }
}

/**
 * A lock is stale when its owner process no longer exists.
 *
 * `owner` uses the `<pid>:<label>` shape written by the composition roots.
 */
function isStale(owner: string | null): boolean {
  if (owner === null || owner.length === 0) return true

  const [pidText] = owner.split(':')
  const pid = Number(pidText)
  if (!Number.isInteger(pid) || pid <= 0) return true

  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH'
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}
