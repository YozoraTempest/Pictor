// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, it } from 'vitest'

import { GitBashCommandExecutor } from './command-executor.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

it('terminates and classifies a command that exceeds its deadline', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'pictor-command-timeout-'))
  roots.push(projectRoot)
  const executor = new GitBashCommandExecutor(200)

  await expect(executor.execute('sleep 5', projectRoot)).rejects.toThrow('命令执行超时（1 秒）')
})
