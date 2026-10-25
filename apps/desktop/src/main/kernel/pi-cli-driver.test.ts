import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { HarnessNotification } from '@pictor/harness'
import { afterEach, describe, expect, it } from 'vitest'

import { PiCliDriver } from './pi-cli-driver.js'

/**
 * The driver's job is translation, so the test drives it with a stand-in for Pi.
 *
 * What goes wrong here is invisible until a real turn runs: a frame nested the
 * wrong way is silently dropped by the bridge, and a run that closes without an
 * answer looks like a blank turn. A script that prints the same JSONL Pi prints
 * pins the shape down without spending a model call.
 */

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A fake `pi` that answers every turn with the given stdout lines. */
function fakePi(lines: readonly unknown[]): { binary: string; userData: string } {
  const userData = mkdtempSync(join(tmpdir(), 'pictor-pi-'))
  dirs.push(userData)
  const binary = join(userData, 'fake-pi')
  writeFileSync(
    binary,
    `#!/bin/sh\ncat <<'JSONL'\n${lines.map((line) => JSON.stringify(line)).join('\n')}\nJSONL\n`,
    {
      mode: 0o755,
    },
  )
  return { binary, userData }
}

function driverFor(fake: { binary: string; userData: string }): PiCliDriver {
  return new PiCliDriver({
    userData: fake.userData,
    binary: fake.binary,
    resolveCwd: () => Promise.resolve(fake.userData),
  })
}

/** Runs one turn and resolves with every notification it produced. */
async function turn(
  driver: PiCliDriver,
  sessionId = 's1',
  text = '你好',
): Promise<{ method: string; params: unknown }[]> {
  const seen: HarnessNotification[] = []
  const done = new Promise<void>((resolve) => {
    driver.onNotification((notification) => {
      seen.push(notification)
      const params = notification.params as { frame?: { type?: string; event?: { type?: string } } }
      if (params.frame?.type === 'event' && params.frame.event?.type === 'turn/end') resolve()
    })
  })
  await driver.prompt(sessionId, text)
  await done
  return seen as { method: string; params: unknown }[]
}

/** The durable events, flattened out of their follow frames. */
function eventsOf(seen: { params: unknown }[]): { type: string; data: unknown }[] {
  return seen.flatMap((notification): { type: string; data: unknown }[] => {
    const params = notification.params as {
      frame?: { type?: string; event?: { type?: string; data?: unknown } }
    }
    const frame = params.frame
    if (frame?.type !== 'event' || frame.event?.type === undefined) return []
    return [{ type: frame.event.type, data: frame.event.data }]
  })
}

/** The model stream chunks, in order. */
function chunksOf(seen: { params: unknown }[]): Record<string, unknown>[] {
  return seen.flatMap((notification): Record<string, unknown>[] => {
    const params = notification.params as {
      frame?: { type?: string; frame?: { chunk?: Record<string, unknown> } }
    }
    if (params.frame?.type !== 'assistant-stream') return []
    const chunk = params.frame.frame?.chunk
    return chunk === undefined ? [] : [chunk]
  })
}

describe('PiCliDriver', () => {
  it('turns one process into one Pictor turn', async () => {
    const fake = fakePi([
      { type: 'session', id: 'pi-session-1' },
      { type: 'agent_start' },
      { type: 'turn_start' },
      {
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_delta', delta: '想一下' },
      },
      { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '等于' } },
      { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: ' 2' } },
      {
        type: 'tool_execution_start',
        toolCallId: 'c1',
        toolName: 'bash',
        args: { command: 'echo hi' },
      },
      {
        type: 'tool_execution_end',
        toolCallId: 'c1',
        toolName: 'bash',
        result: { content: [{ type: 'text', text: 'hi\n' }] },
        isError: false,
      },
      {
        type: 'turn_end',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '等于 2' }],
          usage: { input: 10, output: 5, totalTokens: 15 },
        },
      },
      { type: 'agent_end', messages: [], willRetry: false },
    ])

    const driver = driverFor(fake)
    const seen = await turn(driver)

    const events = eventsOf(seen)
    expect(events.map((event) => event.type)).toEqual([
      'turn/start',
      'tool/call',
      'tool/result',
      'assistant/message',
      'turn/end',
    ])

    // The bridge keys the run on `data.turn`, so the number has to be there.
    expect(events[0]?.data).toEqual({ turn: 1 })

    // A call carries the name, the id its result will use, and JSON arguments.
    expect(events[1]?.data).toEqual({
      name: 'bash',
      callId: 'c1',
      arguments: JSON.stringify({ command: 'echo hi' }),
    })
    expect(events[2]?.data).toEqual({
      message: {
        toolCallId: 'c1',
        isError: false,
        content: [{ type: 'text', text: 'hi\n' }],
      },
    })
    expect(events[4]?.data).toEqual({ reason: { kind: 'completed' } })

    // Text and thinking travel as separate chunks, in the order they arrived.
    expect(chunksOf(seen)).toEqual([
      { type: 'reasoning-delta', text: '想一下' },
      { type: 'text-delta', text: '等于' },
      { type: 'text-delta', text: ' 2' },
      { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
    ])
  })

  it("keeps one turn open across Pi's model steps", async () => {
    // Pi opens a turn per model step; the window keys its stream on Pictor's turn,
    // so a second step must not restart the answer bubble.
    const fake = fakePi([
      { type: 'session', id: 'pi-session-2' },
      { type: 'turn_start' },
      { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'A' } },
      { type: 'turn_end', message: { role: 'assistant', content: [] } },
      { type: 'turn_start' },
      { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'B' } },
      { type: 'turn_end', message: { role: 'assistant', content: [] } },
      { type: 'agent_end', messages: [] },
    ])

    const seen = await turn(driverFor(fake))
    expect(eventsOf(seen).filter((event) => event.type === 'turn/start')).toHaveLength(1)
    expect(chunksOf(seen).map((chunk) => chunk['text'])).toEqual(['A', 'B'])
  })

  it('closes an empty turn as a failure instead of a blank answer', async () => {
    const fake = fakePi([{ type: 'session', id: 'pi-session-3' }, { type: 'agent_start' }])
    const seen = await turn(driverFor(fake))

    const end = eventsOf(seen).at(-1)
    expect(end?.type).toBe('turn/end')
    expect(end?.data).toMatchObject({ reason: { kind: 'error' } })
    expect(JSON.stringify(end?.data)).toContain('没有返回任何内容')
  })

  it('reads its own session file back into rows', async () => {
    const fake = fakePi([
      { type: 'session', id: 'pi-session-4' },
      { type: 'turn_start' },
      { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '好' } },
      { type: 'turn_end', message: { role: 'assistant', content: [{ type: 'text', text: '好' }] } },
      { type: 'agent_end', messages: [] },
    ])
    const driver = driverFor(fake)
    await turn(driver)

    // The id Pi reported is what names the file, and it is what a restart resumes.
    expect(driver.status().home).toBe(join(fake.userData, 'pi-sessions'))
    // Nothing recorded yet: no rows rather than a failed read.
    expect(await driver.historyPage('s1', 50, 0)).toEqual({
      messages: [],
      nextOffset: 0,
      hasMore: false,
    })
  })

  it('refuses a second turn while one is running', async () => {
    const fake = fakePi([{ type: 'session', id: 'pi-session-5' }, { type: 'turn_start' }])
    const driver = driverFor(fake)
    // No turn/end in the script, but the process exits, so the first turn closes.
    await turn(driver)

    // Images cannot be attached through the CLI, and saying so beats dropping them.
    await expect(
      driver.prompt('s1', '看图', [{ mediaType: 'image/png', data: 'AAAA' }]),
    ).rejects.toThrow(/图片/)
  })
})
