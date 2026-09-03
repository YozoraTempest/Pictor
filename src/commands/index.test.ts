// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { commandEventSchema, type CommandEvent } from './contract.js'
import { CommandFailure, executeCommandAndWait, type CommandClient } from './index.js'

const execution = {
  executionId: '00000000-0000-4000-8000-000000000001',
  commandId: 'test.wait',
} as const
const now = '2026-09-01T00:00:00.000Z'

function started(): CommandEvent {
  return commandEventSchema.parse({
    type: 'started',
    executionId: execution.executionId,
    commandId: execution.commandId,
    sequence: 0,
    at: now,
    context: { frontend: 'gui' },
  })
}

function terminalEvent(
  event: 'completed' | 'failed' | 'cancelled',
  value: unknown = null,
): CommandEvent {
  if (event === 'completed') {
    return commandEventSchema.parse({
      type: event,
      executionId: execution.executionId,
      commandId: execution.commandId,
      sequence: 1,
      at: now,
      result: { ...execution, value },
    })
  }
  if (event === 'failed') {
    return commandEventSchema.parse({
      type: event,
      executionId: execution.executionId,
      commandId: execution.commandId,
      sequence: 1,
      at: now,
      error: {
        code: 'handler-failed',
        message: '命令处理器执行失败',
        commandId: execution.commandId,
        executionId: execution.executionId,
      },
    })
  }
  return commandEventSchema.parse({
    type: event,
    executionId: execution.executionId,
    commandId: execution.commandId,
    sequence: 1,
    at: now,
    reason: 'requested',
  })
}

function clientWithReplay(events: readonly CommandEvent[]): {
  client: CommandClient
  release: ReturnType<typeof vi.fn>
} {
  const release = vi.fn()
  const client: CommandClient = {
    list: vi.fn(async () => []),
    execute: vi.fn(async () => execution),
    cancel: vi.fn(async () => ({ executionId: execution.executionId, accepted: false })),
    subscribe: vi.fn((_executionId, listener) => {
      for (const event of events) listener(event)
      return release
    }),
  }
  return { client, release }
}

describe('executeCommandAndWait', () => {
  it('replays a terminal event that arrived before subscribe returned', async () => {
    const { client, release } = clientWithReplay([
      started(),
      terminalEvent('completed', { ok: true }),
    ])

    await expect(
      executeCommandAndWait(
        client,
        execution.commandId,
        null,
        { frontend: 'gui' },
        z.object({ ok: z.boolean() }),
      ),
    ).resolves.toEqual({ ok: true })
    expect(release).toHaveBeenCalledOnce()
  })

  it.each([
    ['failed', 'handler-failed'],
    ['cancelled', 'cancelled'],
  ] as const)('classifies %s terminal events', async (event, code) => {
    const { client, release } = clientWithReplay([started(), terminalEvent(event)])

    await expect(
      executeCommandAndWait(client, execution.commandId, null, { frontend: 'gui' }, z.null()),
    ).rejects.toMatchObject({ code })
    expect(release).toHaveBeenCalledOnce()
  })

  it('classifies a completed value that fails the output schema', async () => {
    const { client, release } = clientWithReplay([started(), terminalEvent('completed', { ok: 1 })])

    const error = await executeCommandAndWait(
      client,
      execution.commandId,
      null,
      { frontend: 'gui' },
      z.object({ ok: z.boolean() }),
    ).catch((value: unknown) => value)

    expect(error).toBeInstanceOf(CommandFailure)
    expect(error).toMatchObject({ code: 'invalid-output', executionId: execution.executionId })
    expect(release).toHaveBeenCalledOnce()
  })
})
