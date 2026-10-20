import { describe, expect, it, vi } from 'vitest'

import { CommandEngine, CommandError } from './command-engine.js'

describe('CommandEngine', () => {
  it('lists commands sorted by id', () => {
    const engine = new CommandEngine()
    engine.register({ id: 'b', description: 'second', handler: () => null })
    engine.register({ id: 'a', description: 'first', handler: () => null })

    expect(engine.list().map((command) => command.id)).toEqual(['a', 'b'])
  })

  it('rejects duplicate ids', () => {
    const engine = new CommandEngine()
    engine.register({ id: 'a', description: 'first', handler: () => null })

    expect(() => engine.register({ id: 'a', description: 'again', handler: () => null })).toThrow(
      CommandError,
    )
  })

  it('passes input to the handler and returns its output', async () => {
    const engine = new CommandEngine()
    const handler = vi.fn((input: { value: number }) => ({ doubled: input.value * 2 }))

    engine.register({ id: 'double', description: 'double', handler })

    await expect(engine.execute('double', { value: 21 })).resolves.toEqual({ doubled: 42 })
    expect(handler).toHaveBeenCalledWith({ value: 21 })
  })

  it('throws a typed error for unknown commands', async () => {
    const engine = new CommandEngine()

    await expect(engine.execute('nope')).rejects.toMatchObject({ code: 'unknown-command' })
  })

  it('unregisters through the returned disposer', () => {
    const engine = new CommandEngine()
    const dispose = engine.register({ id: 'temp', description: 'temp', handler: () => null })

    dispose()

    expect(engine.has('temp')).toBe(false)
  })
})
