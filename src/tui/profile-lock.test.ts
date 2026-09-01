// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, it } from 'vitest'

import { ProfileFileLock } from '../application/index.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

it.each(['gui', 'cli'] as const)(
  'conflicts with an existing %s Frontend on the same Profile',
  async (frontend) => {
    const root = await mkdtemp(join(tmpdir(), 'pictor-tui-lock-'))
    roots.push(root)
    const owner = new ProfileFileLock(root, {
      frontend,
      pid: process.pid,
      hostname: 'tui-test-host',
      localHostname: 'tui-test-host',
    })
    const tui = new ProfileFileLock(root, {
      frontend: 'tui',
      pid: process.pid,
      hostname: 'tui-test-host',
      localHostname: 'tui-test-host',
    })

    const lease = await owner.acquire()
    expect(lease).not.toBeNull()
    await expect(tui.acquire()).resolves.toBeNull()
    expect(tui.getConflict()).toMatchObject({ owner: { frontend } })
    await lease!.release()
    await expect(tui.acquire()).resolves.toBeTruthy()
  },
)
