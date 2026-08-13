// @vitest-environment node

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, it, vi } from 'vitest'

import { BashCommandExecutor } from './command-executor.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

it('terminates and classifies a command that exceeds its deadline', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'pictor-command-timeout-'))
  roots.push(projectRoot)
  const bashPath =
    process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : '/bin/bash'
  const executor = new BashCommandExecutor(bashPath, 200)

  await expect(executor.execute('sleep 5', projectRoot)).rejects.toThrow('命令执行超时（1 秒）')
})

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

async function waitForPid(path: string): Promise<number> {
  let pid = 0
  await vi.waitFor(
    async () => {
      pid = Number(await readFile(path, 'utf8'))
      expect(pid).toBeGreaterThan(0)
    },
    { timeout: 2_000, interval: 20 },
  )
  return pid
}

it.runIf(process.platform !== 'win32')(
  'terminates the complete POSIX process group when aborted',
  async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'pictor-command-abort-'))
    roots.push(projectRoot)
    const pidPath = join(projectRoot, 'child.pid')
    const controller = new AbortController()
    const executor = new BashCommandExecutor('/bin/bash', 5_000)
    const execution = executor.execute(
      `sleep 30 & echo $! > '${pidPath}'; wait`,
      projectRoot,
      controller.signal,
    )
    const childPid = await waitForPid(pidPath)

    controller.abort(new Error('cancelled by test'))

    await expect(execution).rejects.toThrow('cancelled by test')
    await vi.waitFor(() => expect(processExists(childPid)).toBe(false), {
      timeout: 2_000,
      interval: 20,
    })
  },
)

it.runIf(process.platform !== 'win32')(
  'terminates the complete POSIX process group after a timeout',
  async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'pictor-command-tree-timeout-'))
    roots.push(projectRoot)
    const pidPath = join(projectRoot, 'child.pid')
    const executor = new BashCommandExecutor('/bin/bash', 300)
    const execution = executor.execute(`sleep 30 & echo $! > '${pidPath}'; wait`, projectRoot)
    const childPid = await waitForPid(pidPath)

    await expect(execution).rejects.toThrow('命令执行超时（1 秒）')
    await vi.waitFor(() => expect(processExists(childPid)).toBe(false), {
      timeout: 2_000,
      interval: 20,
    })
  },
)
