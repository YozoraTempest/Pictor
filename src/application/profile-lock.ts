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
  readonly localHostname?: string
  readonly now?: () => Date
  readonly createToken?: () => string
  readonly fileSystem?: ProfileLockFileSystem
}

export interface ProfileLockFileHandle {
  writeFile(content: string, encoding: 'utf8'): Promise<void>
  sync(): Promise<void>
  close(): Promise<void>
}

export interface ProfileLockFileSystem {
  mkdir(path: string): Promise<void>
  open(path: string, flags: string, mode?: number): Promise<ProfileLockFileHandle>
  readFile(path: string, encoding: 'utf8'): Promise<string>
  unlink(path: string): Promise<void>
}

const defaultFileSystem: ProfileLockFileSystem = {
  mkdir: async (path) => {
    await mkdir(path, { recursive: true })
  },
  open: (path, flags, mode) => open(path, flags, mode),
  readFile: (path, encoding) => readFile(path, encoding),
  unlink: (path) => unlink(path),
}

/**
 * An exclusive lock for a Pictor user-data directory.
 *
 * The lock is intentionally conservative: only valid local owner metadata
 * whose process is proven absent can be recovered. Release only unlinks a
 * file whose token still proves that this instance owns it.
 */
export class ProfileFileLock implements FrontendLock {
  readonly profilePath: string
  readonly lockPath: string

  private readonly options: Required<
    Pick<
      ProfileFileLockOptions,
      'frontend' | 'pid' | 'hostname' | 'localHostname' | 'now' | 'createToken' | 'fileSystem'
    >
  >
  private leaseToken: string | null = null
  private lockHandle: ProfileLockFileHandle | null = null
  private lastConflict: ProfileLockConflict | null = null

  constructor(profilePath: string, options: ProfileFileLockOptions) {
    this.profilePath = resolve(profilePath)
    this.lockPath = join(this.profilePath, PROFILE_LOCK_FILE)
    const localHostname = options.localHostname ?? hostname()
    this.options = {
      frontend: options.frontend,
      pid: options.pid ?? process.pid,
      hostname: options.hostname ?? localHostname,
      localHostname,
      now: options.now ?? (() => new Date()),
      createToken: options.createToken ?? randomUUID,
      fileSystem: options.fileSystem ?? defaultFileSystem,
    }
  }

  async acquire(): Promise<FrontendLockLease | null> {
    if (this.leaseToken !== null) {
      throw new Error('Profile lock has already been acquired by this instance')
    }
    this.lastConflict = null
    await this.options.fileSystem.mkdir(this.profilePath)

    const owner = profileLockOwnerSchema.parse({
      schemaVersion: 1,
      token: this.options.createToken(),
      pid: this.options.pid,
      hostname: this.options.hostname,
      frontend: this.options.frontend,
      profilePath: this.profilePath,
      acquiredAt: this.options.now().toISOString(),
    })

    const handle = await this.openLockFile()
    if (!handle) return null

    try {
      await handle.writeFile(`${JSON.stringify(owner)}\n`, 'utf8')
      await handle.sync()
      this.lockHandle = handle
      this.leaseToken = owner.token
    } catch (error) {
      await handle.close().catch(() => undefined)
      await this.options.fileSystem.unlink(this.lockPath).catch(() => undefined)
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

  private async openLockFile(): Promise<ProfileLockFileHandle | null> {
    try {
      return await this.options.fileSystem.open(this.lockPath, 'wx', 0o600)
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'EEXIST') throw error

      const existingOwner = await readLockOwner(this.lockPath, this.options.fileSystem)
      if (!(await this.tryRemoveStaleLock(existingOwner))) {
        this.lastConflict = { lockPath: this.lockPath, owner: existingOwner }
        return null
      }

      try {
        return await this.options.fileSystem.open(this.lockPath, 'wx', 0o600)
      } catch (retryError) {
        if (!isNodeError(retryError) || retryError.code !== 'EEXIST') throw retryError
        this.lastConflict = {
          lockPath: this.lockPath,
          owner: await readLockOwner(this.lockPath, this.options.fileSystem),
        }
        return null
      }
    }
  }

  private async tryRemoveStaleLock(owner: ProfileLockOwner | null): Promise<boolean> {
    if (!owner) return false
    if (owner.hostname !== this.options.localHostname) return false
    if (owner.profilePath !== this.profilePath) return false
    if (!isProcessAbsent(owner.pid)) return false

    const currentOwner = await readLockOwner(this.lockPath, this.options.fileSystem)
    if (
      !currentOwner ||
      currentOwner.token !== owner.token ||
      currentOwner.profilePath !== owner.profilePath
    ) {
      return false
    }

    try {
      await this.options.fileSystem.unlink(this.lockPath)
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') throw error
    }
    return true
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
        const current = await readLockOwner(this.lockPath, this.options.fileSystem)
        if (current?.token === owner.token && current.profilePath === owner.profilePath) {
          await this.options.fileSystem.unlink(this.lockPath).catch((error: unknown) => {
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

async function readLockOwner(
  path: string,
  fileSystem: ProfileLockFileSystem,
): Promise<ProfileLockOwner | null> {
  try {
    return profileLockOwnerSchema.parse(JSON.parse(await fileSystem.readFile(path, 'utf8')))
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return null
    if (error instanceof z.ZodError || error instanceof SyntaxError) return null
    throw error
  }
}

function isProcessAbsent(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    return isNodeError(error) && error.code === 'ESRCH'
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
