// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (event: { senderFrame: null }, input?: unknown) => unknown>()
  const send = vi.fn()
  return {
    handlers,
    send,
    windows: [{ webContents: { send } }],
  }
})

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => mocks.windows,
  },
  ipcMain: {
    handle: (
      channel: string,
      handler: (event: { senderFrame: null }, input?: unknown) => unknown,
    ) => mocks.handlers.set(channel, handler),
    removeHandler: (channel: string) => mocks.handlers.delete(channel),
  },
}))

import { commandDescriptorSchema } from '../commands/contract.js'
import { CommandEngine } from '../commands/engine.js'
import { registerCommandIpc } from './command-ipc.js'

async function invoke(channel: string, input?: unknown): Promise<unknown> {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`)
  return handler({ senderFrame: null }, input)
}

describe('Command IPC transport', () => {
  it('validates requests, forwards list/execute, and transports command events', async () => {
    const engine = new CommandEngine([
      {
        descriptor: commandDescriptorSchema.parse({
          id: 'test.transport',
          title: 'Transport',
          description: 'Transport test command',
          inputSchema: { type: 'null' },
          execution: { cancellable: false, recoverySafe: true },
        }),
        input: z.null(),
        output: z.object({ ok: z.literal(true) }),
        handler: () => ({ ok: true }),
      },
    ])
    const registration = registerCommandIpc(engine.getClient(), vi.fn())

    await expect(invoke('command:list', {})).resolves.toMatchObject({
      ok: true,
      value: [expect.objectContaining({ id: 'test.transport' })],
    })
    const execute = (await invoke('command:execute', {
      commandId: 'test.transport',
      input: null,
      context: { frontend: 'gui' },
    })) as { ok: boolean; value?: { executionId: string } }
    expect(execute).toMatchObject({ ok: true, value: { executionId: expect.any(String) } })
    expect(mocks.send).toHaveBeenCalledWith(
      'command:event',
      expect.objectContaining({ type: 'started', commandId: 'test.transport' }),
    )

    await expect(
      invoke('command:execute', {
        commandId: 'test.transport',
        input: null,
        context: { frontend: 'not-a-frontend' },
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'invalid-input' } })
    await expect(
      invoke('command:execute', {
        commandId: 'test.unknown',
        input: null,
        context: { frontend: 'gui' },
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'unknown-command' } })

    registration.dispose()
    expect(mocks.handlers.size).toBe(0)
    await engine.dispose()
  })
})
