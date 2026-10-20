import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ProfileLockedError, acquireProfileLock } from './profile-lock.js'

function lockPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'pictor-lock-')), 'profile.lock')
}

describe('acquireProfileLock', () => {
  it('acquires and releases the lock', async () => {
    const path = lockPath()
    const lock = await acquireProfileLock({ path, owner: `${process.pid}:test`, nowait: true })

    expect(readFileSync(path, 'utf8')).toBe(`${process.pid}:test`)
    lock.release()
    expect(() => readFileSync(path, 'utf8')).toThrow()
  })

  it('refuses a second holder while the owner is alive', async () => {
    const path = lockPath()
    const lock = await acquireProfileLock({ path, owner: `${process.pid}:first`, nowait: true })

    await expect(
      acquireProfileLock({ path, owner: `${process.pid}:second`, nowait: true }),
    ).rejects.toBeInstanceOf(ProfileLockedError)

    lock.release()
  })

  it('reclaims a lock whose owner process is gone', async () => {
    const path = lockPath()
    writeFileSync(path, '999999:dead')

    const lock = await acquireProfileLock({ path, owner: `${process.pid}:test`, nowait: true })

    expect(readFileSync(path, 'utf8')).toBe(`${process.pid}:test`)
    lock.release()
  })

  it('treats an empty lock file as stale', async () => {
    const path = lockPath()
    writeFileSync(path, '')

    const lock = await acquireProfileLock({ path, owner: `${process.pid}:test`, nowait: true })

    expect(readFileSync(path, 'utf8')).toBe(`${process.pid}:test`)
    lock.release()
  })

  it('waits for the lock when a timeout is given', async () => {
    const path = lockPath()
    const owner = await acquireProfileLock({
      path,
      owner: `${process.pid}:owner`,
      nowait: true,
    })

    const started = Date.now()
    setTimeout(() => owner.release(), 60)

    const contender = await acquireProfileLock({
      path,
      owner: `${process.pid}:contender`,
      timeoutMs: 2_000,
      pollIntervalMs: 20,
    })

    expect(Date.now() - started).toBeGreaterThanOrEqual(40)
    contender.release()
  })
})
