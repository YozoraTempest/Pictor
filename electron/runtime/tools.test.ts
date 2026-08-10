// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApprovalBroker } from './approval-broker.js'
import type { CommandExecutor } from './command-executor.js'
import { ProjectPathGuard } from './path-guard.js'
import { createPictorTools } from './tools.js'

describe('Pictor runtime tools', () => {
  let projectRoot: string
  let guard: ProjectPathGuard
  const roots: string[] = []

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'pictor-tools-'))
    roots.push(projectRoot)
    await mkdir(join(projectRoot, 'src'))
    guard = await ProjectPathGuard.create(projectRoot)
  })

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  function setup() {
    const requested = vi.fn()
    const resolved = vi.fn()
    const approvals = new ApprovalBroker(requested)
    const execute = vi.fn<CommandExecutor['execute']>().mockResolvedValue({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
    })
    let cancelled = false
    const tools = createPictorTools({
      guard,
      approvals,
      commandExecutor: { execute },
      isCancelled: () => cancelled,
      onApprovalResolved: resolved,
    })
    return {
      approvals,
      command: tools.find((tool) => tool.name === 'pictor_command')!,
      edit: tools.find((tool) => tool.name === 'pictor_edit')!,
      execute,
      requested,
      resolved,
      setCancelled: () => {
        cancelled = true
      },
      write: tools.find((tool) => tool.name === 'pictor_write')!,
    }
  }

  it('does not start a command before a matching one-time approval', async () => {
    const { approvals, command, execute, requested } = setup()
    const pending = command.execute(
      'call-1',
      { command: 'npm test', cwd: '.', purpose: 'Verify changes' },
      undefined,
      undefined,
      {} as never,
    )
    await vi.waitFor(() => expect(requested).toHaveBeenCalledOnce())
    expect(execute).not.toHaveBeenCalled()

    expect(approvals.resolve('call-1', true)).toBe(true)
    expect(approvals.resolve('call-1', true)).toBe(false)
    await expect(pending).resolves.toMatchObject({ details: { exitCode: 0 } })
    expect(execute).toHaveBeenCalledOnce()
  })

  it('never executes a rejected command', async () => {
    const { approvals, command, execute, requested, resolved } = setup()
    const pending = command.execute(
      'call-2',
      { command: 'remove something', cwd: '.', purpose: 'Rejected test' },
      undefined,
      undefined,
      {} as never,
    )
    await vi.waitFor(() => expect(requested).toHaveBeenCalledOnce())
    approvals.resolve('call-2', false)

    await expect(pending).rejects.toThrow('用户拒绝')
    expect(execute).not.toHaveBeenCalled()
    expect(resolved).toHaveBeenCalledWith(expect.objectContaining({ callId: 'call-2' }), false)
  })

  it('starts no file operation after cancellation', async () => {
    const { setCancelled, write } = setup()
    setCancelled()
    await expect(
      write.execute(
        'write-1',
        { path: 'src/new.txt', content: 'blocked' },
        undefined,
        undefined,
        {} as never,
      ),
    ).rejects.toThrow('不再开始新的工具操作')
    await expect(readFile(join(projectRoot, 'src', 'new.txt'), 'utf8')).rejects.toThrow()
  })

  it('writes and edits files only through guarded project paths', async () => {
    const { write, edit } = setup()
    await write.execute(
      'write-2',
      { path: 'src/example.txt', content: 'before' },
      undefined,
      undefined,
      {} as never,
    )
    await edit.execute(
      'edit-1',
      { path: 'src/example.txt', oldText: 'before', newText: 'after' },
      undefined,
      undefined,
      {} as never,
    )
    expect(await readFile(join(projectRoot, 'src', 'example.txt'), 'utf8')).toBe('after')
  })
})
