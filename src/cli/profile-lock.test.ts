// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { PROFILE_LOCK_FILE, ProfileFileLock } from '../application/profile-lock.js'

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
})
