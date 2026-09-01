// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { commandDescriptorSchema, type CommandDescriptor, type CommandEvent } from './contract.js'
import { CommandEngine, type CommandDefinition } from './engine.js'

const context = { frontend: 'cli' as const }

function descriptor(
  id: string,
  inputSchema: CommandDescriptor['inputSchema'] = { type: 'null' },
  cancellable = false,
): CommandDescriptor {
  return commandDescriptorSchema.parse({
    id,
    title: id,
    description: `Test command ${id}`,
    inputSchema,
    execution: { cancellable, recoverySafe: true },
  })
}

function command<TInputSchema extends z.ZodType, TOutputSchema extends z.ZodType>(
  id: string,
  input: TInputSchema,
  output: TOutputSchema,
  handler: CommandDefinition<TInputSchema, TOutputSchema>['handler'],
  cancellable = false,
): CommandDefinition<TInputSchema, TOutputSchema> {
  return { descriptor: descriptor(id, { type: 'object' }, cancellable), input, output, handler }
}

async function terminalEvents(client: ReturnType<CommandEngine['getClient']>, executionId: string) {
  const events: CommandEvent[] = []
  let released = false
  let release: (() => void) | null = null
  await new Promise<void>((resolve) => {
    const finish = (): void => {
      if (released) return
      released = true
      resolve()
      release?.()
    }
    release = client.subscribe(executionId, (event) => {
      events.push(event)
      if (event.type === 'completed' || event.type === 'failed' || event.type === 'cancelled') {
        finish()
      }
    })
    if (released) release()
  })
  return events
}

describe('CommandEngine', () => {
  it('keeps descriptors immutable and rejects Plugin registration over Core commands', async () => {
    const core = command('app.info', z.null(), z.object({ ok: z.literal(true) }), () => ({
      ok: true as const,
    }))
    const engine = new CommandEngine([core])
    const client = engine.getClient()

    const listed = await client.list()
    expect(listed).toHaveLength(1)
    expect(Object.isFrozen(listed)).toBe(true)
    expect(Object.isFrozen(listed[0])).toBe(true)
    expect(() => {
      ;(listed[0] as { id: string }).id = 'overwritten'
    }).toThrow()

    const plugin = command('app.info', z.null(), z.object({ ok: z.literal(false) }), () => ({
      ok: false as const,
    }))
    expect(() => engine.registerPluginCommands('pictor.test', [plugin])).toThrow('命令注册冲突')
    await expect(client.list()).resolves.toHaveLength(1)
    await engine.dispose()
  })

  it('validates input and structured output at the Engine seam', async () => {
    const engine = new CommandEngine([
      command(
        'test.echo',
        z.object({ value: z.string() }),
        z.object({ value: z.string() }),
        (input) => input,
      ),
    ])
    const client = engine.getClient()

    await expect(client.execute('test.echo', { value: 42 }, context)).rejects.toMatchObject({
      code: 'invalid-input',
      field: 'value',
    })

    const invalidOutputEngine = new CommandEngine([
      {
        descriptor: descriptor('test.invalid-output'),
        input: z.null(),
        output: z.string(),
        handler: () => 42,
      },
    ])
    const invalidOutputClient = invalidOutputEngine.getClient()
    const execution = await invalidOutputClient.execute('test.invalid-output', null, context)
    const events = await terminalEvents(invalidOutputClient, execution.executionId)
    expect(events.at(-1)).toMatchObject({ type: 'failed', error: { code: 'invalid-output' } })

    await engine.dispose()
    await invalidOutputEngine.dispose()
  })

  it('keeps permission decisions internal to execution', async () => {
    const engine = new CommandEngine([
      {
        descriptor: descriptor('test.restricted'),
        input: z.null(),
        output: z.null(),
        isAllowed: (value) => value.frontend === 'gui',
        handler: () => null,
      },
    ])
    const client = engine.getClient()

    await expect(client.list()).resolves.toEqual([
      expect.not.objectContaining({ isAllowed: expect.anything() }),
    ])
    await expect(
      client.execute('test.restricted', null, { frontend: 'shell' }),
    ).rejects.toMatchObject({ code: 'not-allowed', commandId: 'test.restricted' })
    await expect(client.execute('test.restricted', null, { frontend: 'gui' })).resolves.toEqual(
      expect.objectContaining({ commandId: 'test.restricted' }),
    )
    await engine.dispose()
  })

  it('emits started, progress, output, and completed in sequence', async () => {
    const output = z.object({ kind: z.enum(['chunk', 'done']) })
    const engine = new CommandEngine([
      command('test.stream', z.null(), output, (_input, handlerContext) => {
        handlerContext.reportProgress({ message: 'halfway', percent: 0.5 })
        handlerContext.emitOutput({ kind: 'chunk' })
        return { kind: 'done' as const }
      }),
    ])
    const client = engine.getClient()
    const execution = await client.execute('test.stream', null, context)
    const events = await terminalEvents(client, execution.executionId)

    expect(events.map((event) => event.type)).toEqual([
      'started',
      'progress',
      'output',
      'completed',
    ])
    expect(events.map((event) => event.sequence)).toEqual([0, 1, 2, 3])
    expect(events.at(-1)).toMatchObject({
      type: 'completed',
      result: {
        executionId: execution.executionId,
        commandId: 'test.stream',
        value: { kind: 'done' },
      },
    })
    await engine.dispose()
  })

  it('gives concurrent executions distinct identities and preserves each context', async () => {
    const release = vi.fn()
    const engine = new CommandEngine([
      command(
        'test.identity',
        z.null(),
        z.object({ executionId: z.uuid() }),
        async (_input, context) => {
          await new Promise<void>((resolve) => setTimeout(resolve, 5))
          release(context.executionId)
          return { executionId: context.executionId }
        },
      ),
    ])
    const client = engine.getClient()
    const first = await client.execute('test.identity', null, context)
    const second = await client.execute('test.identity', null, { frontend: 'gui' })
    expect(first.executionId).not.toBe(second.executionId)

    const [firstEvents, secondEvents] = await Promise.all([
      terminalEvents(client, first.executionId),
      terminalEvents(client, second.executionId),
    ])
    expect(firstEvents.at(-1)).toMatchObject({
      result: { value: { executionId: first.executionId } },
    })
    expect(secondEvents.at(-1)).toMatchObject({
      result: { value: { executionId: second.executionId } },
    })
    expect(release).toHaveBeenCalledTimes(2)
    await engine.dispose()
  })

  it('wins the cancellation race and ignores a late handler completion', async () => {
    let complete: ((value: string) => void) | undefined
    const engine = new CommandEngine([
      command(
        'test.cancel',
        z.null(),
        z.string(),
        () =>
          new Promise<string>((resolve) => {
            complete = resolve
          }),
        true,
      ),
    ])
    const client = engine.getClient()
    const execution = await client.execute('test.cancel', null, context)
    const eventsPromise = terminalEvents(client, execution.executionId)
    await expect(client.cancel(execution.executionId)).resolves.toEqual({
      executionId: execution.executionId,
      accepted: true,
    })
    complete?.('late completion')

    const events = await eventsPromise
    await Promise.resolve()
    expect(events.map((event) => event.type)).toEqual(['started', 'cancelled'])
    await expect(client.cancel(execution.executionId)).resolves.toEqual({
      executionId: execution.executionId,
      accepted: false,
    })
    await engine.dispose()
  })

  it('releases subscriptions and classifies handler and unknown-command errors', async () => {
    const listener = vi.fn()
    const engine = new CommandEngine([
      command('test.failure', z.null(), z.null(), () => {
        throw new Error('private handler detail')
      }),
    ])
    const client = engine.getClient()
    const release = client.subscribe(undefined, listener)
    release()
    release()
    const execution = await client.execute('test.failure', null, context)
    const events = await terminalEvents(client, execution.executionId)

    expect(listener).not.toHaveBeenCalled()
    expect(events.at(-1)).toMatchObject({
      type: 'failed',
      error: { code: 'handler-failed', message: '命令处理器执行失败' },
    })
    await expect(client.execute('test.unknown', null, context)).rejects.toMatchObject({
      code: 'unknown-command',
    })
    await engine.dispose()
  })
})
