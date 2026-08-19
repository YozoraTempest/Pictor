// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { ExtensionUiBroker } from './extension-ui.js'

describe('ExtensionUiBroker', () => {
  it('round-trips select, confirm, input, and editor requests', async () => {
    const events: Array<Record<string, unknown>> = []
    const broker = new ExtensionUiBroker((event) => events.push(event))
    const context = broker.createContext()

    const selected = context.select('Choose model', ['first', 'second'])
    broker.respond(String(events.at(-1)?.requestId), 'second')
    await expect(selected).resolves.toBe('second')

    const confirmed = context.confirm('Continue?', 'Run the Extension')
    broker.respond(String(events.at(-1)?.requestId), true)
    await expect(confirmed).resolves.toBe(true)

    const input = context.input('Name')
    broker.respond(String(events.at(-1)?.requestId), 'Pictor')
    await expect(input).resolves.toBe('Pictor')

    const edited = context.editor('Prompt', 'Initial')
    broker.respond(String(events.at(-1)?.requestId), 'Updated')
    await expect(edited).resolves.toBe('Updated')
  })

  it('cancels pending dialogs and reports TUI-only features as unavailable', async () => {
    const events: Array<Record<string, unknown>> = []
    const broker = new ExtensionUiBroker((event) => events.push(event))
    const context = broker.createContext()
    const pending = context.input('Name')

    broker.cancelAll()

    await expect(pending).resolves.toBeUndefined()
    await expect(
      context.custom(() => {
        throw new Error('not used')
      }),
    ).rejects.toThrow('Custom TUI components are unavailable')
    expect(context.setTheme('dark')).toEqual({
      success: false,
      error: 'TUI themes are unavailable in Pictor RPC mode',
    })
  })
})
