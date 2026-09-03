// @vitest-environment node

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdir, mkdtemp, open, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { PROFILE_LOCK_FILE, ProfileFileLock } from '../application/profile-lock.js'
import type { ProfileLockFileSystem, ProfileLockOwner } from '../application/profile-lock.js'
import { CLI_EXIT_CODES } from './exit-codes.js'
import { runCli } from './run.js'

describe('ProfileFileLock', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('uses atomic creation, exposes owner metadata, and releases for a second instance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pictor-profile-lock-'))
    roots.push(root)
    const profile = join(root, 'profile')
    const first = new ProfileFileLock(profile, {
      frontend: 'cli',
      pid: 101,
      hostname: 'first-host',
      now: () => new Date('2026-09-01T12:00:00.000Z'),
      createToken: () => '11111111-1111-4111-8111-111111111111',
    })
    const second = new ProfileFileLock(profile, {
      frontend: 'gui',
      pid: 202,
      hostname: 'second-host',
    })

    const firstLease = await first.acquire()
    expect(firstLease).not.toBeNull()
    const secondLease = await second.acquire()
    expect(secondLease).toBeNull()
    expect(second.getConflict()).toMatchObject({
      lockPath: join(profile, PROFILE_LOCK_FILE),
      owner: {
        frontend: 'cli',
        pid: 101,
        hostname: 'first-host',
        profilePath: profile,
        token: '11111111-1111-4111-8111-111111111111',
      },
    })
    expect(JSON.parse(await readFile(join(profile, PROFILE_LOCK_FILE), 'utf8'))).toMatchObject({
      schemaVersion: 1,
      frontend: 'cli',
    })

    await firstLease?.release()
    const releasedLease = await second.acquire()
    expect(releasedLease).not.toBeNull()
    await releasedLease?.release()
  })

  it('does not remove a lock whose ownership cannot be proven', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pictor-profile-lock-'))
    roots.push(root)
    const profile = join(root, 'profile')
    await mkdir(profile, { recursive: true })
    const lockPath = join(profile, PROFILE_LOCK_FILE)
    await writeFile(lockPath, '{ not valid json\n', 'utf8')

    const lock = new ProfileFileLock(profile, { frontend: 'cli' })
    await expect(lock.acquire()).resolves.toBeNull()
    expect(lock.getConflict()).toEqual({ lockPath, owner: null })
    await expect(readFile(lockPath, 'utf8')).resolves.toContain('not valid json')
  })

  it('keeps a valid lock owned by another host', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pictor-profile-lock-'))
    roots.push(root)
    const profile = join(root, 'profile')
    await mkdir(profile, { recursive: true })
    const lockPath = join(profile, PROFILE_LOCK_FILE)
    const owner = validOwner(profile, { hostname: 'foreign-host', pid: 2147483647 })
    await writeFile(lockPath, `${JSON.stringify(owner)}\n`, 'utf8')

    const lock = new ProfileFileLock(profile, { frontend: 'cli', localHostname: 'local-host' })
    await expect(lock.acquire()).resolves.toBeNull()
    await expect(readFile(lockPath, 'utf8')).resolves.toBe(`${JSON.stringify(owner)}\n`)
  })

  it('keeps a local lock when the owner process cannot be proven absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pictor-profile-lock-'))
    roots.push(root)
    const profile = join(root, 'profile')
    await mkdir(profile, { recursive: true })
    const lockPath = join(profile, PROFILE_LOCK_FILE)
    const owner = validOwner(profile, { pid: 42424242 })
    await writeFile(lockPath, `${JSON.stringify(owner)}\n`, 'utf8')
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' })
    })

    try {
      const lock = new ProfileFileLock(profile, { frontend: 'cli' })
      await expect(lock.acquire()).resolves.toBeNull()
      await expect(readFile(lockPath, 'utf8')).resolves.toBe(`${JSON.stringify(owner)}\n`)
    } finally {
      kill.mockRestore()
    }
  })

  it('does not unlink a lock that changes before the stale deletion recheck', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pictor-profile-lock-'))
    roots.push(root)
    const profile = join(root, 'profile')
    await mkdir(profile, { recursive: true })
    const lockPath = join(profile, PROFILE_LOCK_FILE)
    const owner = validOwner(profile, { pid: 42424242 })
    const replacement = validOwner(profile, {
      pid: process.pid,
      token: '22222222-2222-4222-8222-222222222222',
    })
    await writeFile(lockPath, `${JSON.stringify(owner)}\n`, 'utf8')
    let readCount = 0
    const unlinkSpy = vi.fn((path: string) => unlink(path))
    const fileSystem: ProfileLockFileSystem = {
      mkdir: async (path) => {
        await mkdir(path, { recursive: true })
      },
      open: (path, flags, mode) => open(path, flags, mode),
      readFile: async (path, encoding) => {
        readCount += 1
        if (readCount === 2) return `${JSON.stringify(replacement)}\n`
        return readFile(path, encoding)
      },
      unlink: unlinkSpy,
    }
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('no such process'), { code: 'ESRCH' })
    })

    try {
      const lock = new ProfileFileLock(profile, { frontend: 'cli', fileSystem })
      await expect(lock.acquire()).resolves.toBeNull()
      expect(unlinkSpy).not.toHaveBeenCalled()
      await expect(readFile(lockPath, 'utf8')).resolves.toBe(`${JSON.stringify(owner)}\n`)
    } finally {
      kill.mockRestore()
    }
  })

  it('recovers a lock left by a child process that exited without releasing it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pictor-profile-lock-'))
    roots.push(root)
    const profile = join(root, 'profile')
    const child = spawnLockHolder(profile, true)
    const childExit = waitForChildExit(child)

    try {
      await waitForChildReady(child)
      await childExit

      const lock = new ProfileFileLock(profile, { frontend: 'cli' })
      const lease = await lock.acquire()
      expect(lease).not.toBeNull()
      expect(JSON.parse(await readFile(join(profile, PROFILE_LOCK_FILE), 'utf8'))).toMatchObject({
        pid: process.pid,
        hostname: hostname(),
        profilePath: resolve(profile),
      })
      await lease?.release()
    } finally {
      await stopChild(child)
    }
  })

  it('keeps an active child owner and reports a CLI profile conflict', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pictor-profile-lock-'))
    roots.push(root)
    const profile = join(root, 'profile')
    const child = spawnLockHolder(profile, false)

    try {
      await waitForChildReady(child)
      const stdout = { write: vi.fn() }
      const stderr = { write: vi.fn() }
      const createApplicationHost = vi.fn(async () => {
        throw new Error('ApplicationHost must not start while the profile is locked')
      })

      const result = await runCli(['doctor'], {
        io: { stdout, stderr },
        version: '0.3.0',
        resolveUserDataDirectory: () => profile,
        createProfileLock: (profilePath) => new ProfileFileLock(profilePath, { frontend: 'cli' }),
        createApplicationHost,
      })

      expect(result.exitCode).toBe(CLI_EXIT_CODES.profileConflict)
      expect(createApplicationHost).not.toHaveBeenCalled()
      expect(JSON.parse(await readFile(join(profile, PROFILE_LOCK_FILE), 'utf8'))).toMatchObject({
        pid: child.pid,
        hostname: hostname(),
      })
    } finally {
      await stopChild(child)
    }
  })

  it('propagates non-ENOENT owner read errors during release', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pictor-profile-lock-'))
    roots.push(root)
    const profile = join(root, 'profile')
    let readError: NodeJS.ErrnoException | null = null
    const fileSystem: ProfileLockFileSystem = {
      mkdir: async (path) => {
        await mkdir(path, { recursive: true })
      },
      open: (path, flags, mode) => open(path, flags, mode),
      readFile: async (path, encoding) => {
        if (readError) throw readError
        return readFile(path, encoding)
      },
      unlink: (path) => unlink(path),
    }
    const lock = new ProfileFileLock(profile, { frontend: 'cli', fileSystem })
    const lease = await lock.acquire()
    expect(lease).not.toBeNull()

    readError = Object.assign(new Error('permission denied'), { code: 'EACCES' })
    await expect(lease?.release()).rejects.toMatchObject({ code: 'EACCES' })
    await expect(readFile(join(profile, PROFILE_LOCK_FILE), 'utf8')).resolves.toContain('pictor')
  })
})

function spawnLockHolder(profile: string, exitAfterReady: boolean): ChildProcessWithoutNullStreams {
  const source = `
    import { randomUUID } from 'node:crypto'
    import { open, mkdir } from 'node:fs/promises'
    import { hostname } from 'node:os'
    import { join, resolve } from 'node:path'

    const profile = resolve(process.argv[1])
    await mkdir(profile, { recursive: true })
    const handle = await open(join(profile, '${PROFILE_LOCK_FILE}'), 'wx', 0o600)
    await handle.writeFile(JSON.stringify({
      schemaVersion: 1,
      token: randomUUID(),
      pid: process.pid,
      hostname: hostname(),
      frontend: 'cli',
      profilePath: profile,
      acquiredAt: new Date().toISOString(),
    }) + '\\n', 'utf8')
    await handle.sync()
    await handle.close()
    await new Promise((resolve) => process.stdout.write('ready\\n', resolve))
    ${exitAfterReady ? 'process.exit(0)' : "await new Promise((resolve) => process.stdin.once('data', resolve))"}
  `
  return spawn(process.execPath, ['--input-type=module', '-e', source, profile], {
    env: { ...process.env },
    stdio: 'pipe',
  })
}

function waitForChildReady(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const onData = (chunk: Buffer): void => {
      if (!chunk.toString().includes('ready')) return
      cleanup()
      resolvePromise()
    }
    const onError = (error: Error): void => {
      cleanup()
      reject(error)
    }
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      cleanup()
      reject(new Error(`lock holder exited before ready: code=${code}, signal=${signal}`))
    }
    const cleanup = (): void => {
      child.stdout.off('data', onData)
      child.off('error', onError)
      child.off('exit', onExit)
    }

    child.stdout.on('data', onData)
    child.once('error', onError)
    child.once('exit', onExit)
  })
}

function waitForChildExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolvePromise) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolvePromise()
      return
    }
    child.once('close', () => resolvePromise())
  })
}

async function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.stdin.write('stop\\n')
  child.stdin.end()
  await waitForChildExit(child)
}

function validOwner(profile: string, overrides: Partial<ProfileLockOwner> = {}): ProfileLockOwner {
  return {
    schemaVersion: 1,
    token: '11111111-1111-4111-8111-111111111111',
    pid: 2147483647,
    hostname: hostname(),
    frontend: 'cli',
    profilePath: resolve(profile),
    acquiredAt: '2026-09-01T12:00:00.000Z',
    ...overrides,
  }
}
