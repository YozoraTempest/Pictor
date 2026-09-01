import { randomUUID } from 'node:crypto'
import { open, mkdir, readFile, unlink } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join, resolve } from 'node:path'

import { z } from 'zod'

import type { FrontendLock, FrontendLockLease } from './ports.js'

export const PROFILE_LOCK_FILE = '.pictor-profile.lock'

const profileLockOwnerSchema = z.object({
  schemaVersion: z.literal(1),
  token: z.uuid(),
  pid: z.number().int().positive(),
  hostname: z.string().min(1),
  frontend: z.enum(['gui', 'tui', 'cli', 'shell']),
  profilePath: z.string().min(1),
  acquiredAt: z.iso.datetime(),
})

export type ProfileLockOwner = z.infer<typeof profileLockOwnerSchema>

export interface ProfileLockConflict {
  readonly lockPath: string
  readonly owner: ProfileLockOwner | null
}

export interface ProfileFileLockOptions {
  readonly frontend: ProfileLockOwner['frontend']
  readonly pid?: number
  readonly hostname?: string
  readonly now?: () => Date
  readonly createToken?: () => string
}

/**
 * An exclusive lock for a Pictor user-data directory.
 *
 * The lock is intentionally conservative: an existing or malformed lock is
 * reported as a conflict and is never removed by a new owner. Release only
 * unlinks a file whose token still proves that this instance owns it.
 */
export class ProfileFileLock implements FrontendLock {
  readonly profilePath: string
  readonly lockPath: string

  private readonly options: Required<
    Pick<ProfileFileLockOptions, 'frontend' | 'pid' | 'hostname' | 'now' | 'createToken'>
  >
  private leaseToken: string | null = null
  private lockHandle: Awaited<ReturnType<typeof open>> | null = null
  private lastConflict: ProfileLockConflict | null = null

  constructor(profilePath: string, options: ProfileFileLockOptions) {
    this.profilePath = resolve(profilePath)
    this.lockPath = join(this.profilePath, PROFILE_LOCK_FILE)
    this.options = {
      frontend: options.frontend,
      pid: options.pid ?? process.pid,
      hostname: options.hostname ?? hostname(),
      now: options.now ?? (() => new Date()),
      createToken: options.createToken ?? randomUUID,
    }
  }

  async acquire(): Promise<FrontendLockLease | null> {
    if (this.leaseToken !== null) {
      throw new Error('Profile lock has already been acquired by this instance')
    }
    this.lastConflict = null
    await mkdir(this.profilePath, { recursive: true })

    const owner = profileLockOwnerSchema.parse({
      schemaVersion: 1,
      token: this.options.createToken(),
      pid: this.options.pid,
      hostname: this.options.hostname,
      frontend: this.options.frontend,
      profilePath: this.profilePath,
      acquiredAt: this.options.now().toISOString(),
    })

    let handle
    try {
      handle = await open(this.lockPath, 'wx', 0o600)
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'EEXIST') throw error
      this.lastConflict = {
        lockPath: this.lockPath,
        owner: await readLockOwner(this.lockPath),
      }
      return null
    }

    try {
      await handle.writeFile(`${JSON.stringify(owner)}\n`, 'utf8')
      await handle.sync()
      this.lockHandle = handle
      this.leaseToken = owner.token
    } catch (error) {
      await handle.close().catch(() => undefined)
      await unlink(this.lockPath).catch(() => undefined)
      throw error
    }

    let released = false
    return {
      release: async () => {
        if (released) return
        released = true
        await this.release(owner)
      },
    }
  }

  getConflict(): ProfileLockConflict | null {
    return this.lastConflict
  }

  private async release(owner: ProfileLockOwner): Promise<void> {
    const handle = this.lockHandle
    if (this.leaseToken !== owner.token || !handle) return

    let firstError: Error | null = null
    try {
      await handle.close()
    } catch (error) {
      firstError = toError(error)
    } finally {
      this.lockHandle = null
      this.leaseToken = null
    }

    if (!firstError) {
      try {
        const current = await readLockOwner(this.lockPath)
        if (current?.token === owner.token && current.profilePath === owner.profilePath) {
          await unlink(this.lockPath).catch((error: unknown) => {
            if (!isNodeError(error) || error.code !== 'ENOENT') throw error
          })
        }
      } catch (error) {
        firstError = toError(error)
      }
    }

    if (firstError) throw firstError
  }
}

async function readLockOwner(path: string): Promise<ProfileLockOwner | null> {
  try {
    return profileLockOwnerSchema.parse(JSON.parse(await readFile(path, 'utf8')))
  } catch (error) {
    if (isNodeError(error)) return null
    if (error instanceof z.ZodError || error instanceof SyntaxError) return null
    throw error
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
