// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  COMMAND_TERMINAL_HISTORY_LIMIT,
  commandEventSchema,
  type CommandEvent,
} from '../commands/contract.js'
import { CommandFailure, type CommandClient } from '../commands/index.js'

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, (event: unknown, input: unknown) => void>()
  const exposed = new Map<string, unknown>()
  return {
    listeners,
    exposed,
    invoke: vi.fn(),
    exposeInMainWorld: vi.fn((name: string, value: unknown) => exposed.set(name, value)),
  }
})

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mocks.exposeInMainWorld },
  ipcRenderer: {
    on: vi.fn((channel: string, listener: (event: unknown, input: unknown) => void) => {
      mocks.listeners.set(channel, listener)
    }),
    removeListener: vi.fn(),
    invoke: mocks.invoke,
  },
}))

import './index.js'

const client = (mocks.exposed.get('pictor') as { commands: CommandClient }).commands
const now = new Date().toISOString()
let nextExecutionNumber = 1

function executionId(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`
}

function emit(event: CommandEvent): void {
  mocks.listeners.get('command:event')?.({}, event)
}

function emitStarted(id: string, commandId: string, correlationId?: string): void {
  emit(
    commandEventSchema.parse({
      type: 'started',
      executionId: id,
      commandId,
      sequence: 0,
      at: now,
      context: { frontend: 'gui', ...(correlationId ? { correlationId } : {}) },
    }),
  )
}

function emitCompleted(id: string, commandId: string): void {
  emit(
    commandEventSchema.parse({
      type: 'completed',
      executionId: id,
      commandId,
      sequence: 1,
      at: now,
      result: { executionId: id, commandId, value: null },
    }),
  )
}

function emitCancelled(id: string, commandId: string): void {
  emit(
    commandEventSchema.parse({
      type: 'cancelled',
      executionId: id,
      commandId,
      sequence: 1,
      at: now,
      reason: 'requested',
    }),
  )
}

beforeEach(() => {
  mocks.invoke.mockReset()
  mocks.invoke.mockImplementation(
    async (
      channel: string,
      input?: { commandId?: string; context?: { correlationId?: string }; executionId?: string },
    ) => {
      if (channel === 'command:execute') {
        const id = executionId(nextExecutionNumber)
        nextExecutionNumber += 1
        const commandId = input?.commandId ?? 'preload.test'
        emitStarted(id, commandId, input?.context?.correlationId)
        if (commandId !== 'preload.active' && commandId !== 'preload.cancel') {
          emitCompleted(id, commandId)
        }
        return { ok: true, value: { executionId: id, commandId } }
      }
      if (channel === 'command:cancel') {
        return {
          ok: true,
          value: { executionId: input?.executionId ?? executionId(1), accepted: true },
        }
      }
      return { ok: true, value: [] }
    },
  )
})

describe('preload CommandClient adapter', () => {
  it('replays events received before execute resolves and rejects unknown subscriptions', async () => {
    const execution = await client.execute('preload.test', null, { frontend: 'gui' })
    const events: CommandEvent[] = []
    const release = client.subscribe(execution.executionId, (event) => events.push(event))

    expect(events.map((event) => event.type)).toEqual(['started', 'completed'])
    release()
    expect(() => client.subscribe(executionId(999), () => undefined)).toThrow(CommandFailure)
    try {
      client.subscribe(executionId(999), () => undefined)
    } catch (error) {
      expect(error).toMatchObject({ code: 'execution-not-found' })
    }
  })

  it('evicts oldest terminal history while retaining an active execution', async () => {
    const active = await client.execute('preload.active', null, { frontend: 'gui' })
    const finishedIds: string[] = []
    for (let index = 0; index < COMMAND_TERMINAL_HISTORY_LIMIT + 2; index += 1) {
      const execution = await client.execute('preload.finished', null, { frontend: 'gui' })
      finishedIds.push(execution.executionId)
    }

    expect(() => client.subscribe(finishedIds[0]!, () => undefined)).toThrow('找不到命令执行')
    const activeEvents: CommandEvent[] = []
    const release = client.subscribe(active.executionId, (event) => activeEvents.push(event))
    expect(activeEvents.map((event) => event.type)).toEqual(['started'])
    release()
  })

  it('forwards only one terminal state when cancellation races a late completion', async () => {
    const execution = await client.execute('preload.cancel', null, { frontend: 'gui' })
    const events: CommandEvent[] = []
    const release = client.subscribe(execution.executionId, (event) => events.push(event))

    await expect(client.cancel(execution.executionId)).resolves.toEqual({
      executionId: execution.executionId,
      accepted: true,
    })
    emitCancelled(execution.executionId, 'preload.cancel')
    emitCompleted(execution.executionId, 'preload.cancel')

    expect(events.map((event) => event.type)).toEqual(['started', 'cancelled'])
    release()
  })
})
