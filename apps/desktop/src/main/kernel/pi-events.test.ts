import { describe, expect, it } from 'vitest'

import { PiTranslator, textOf, type PiFrame } from './pi-events.js'

/**
 * The translator is where a wrong guess costs nothing to find and a lot to miss.
 *
 * Every mistake here is invisible until a real turn runs: a frame shaped the wrong
 * way is dropped by the bridge, and a run that closes without an answer looks like
 * a blank turn. These cases are the whole vocabulary Pi emits.
 */

function events(frames: PiFrame[]): { type: string; data: unknown }[] {
  return frames.flatMap((frame) =>
    frame.kind === 'event' ? [{ type: frame.type, data: frame.data }] : [],
  )
}

function chunks(frames: PiFrame[]): Record<string, unknown>[] {
  return frames.flatMap((frame) => (frame.kind === 'chunk' ? [frame.chunk] : []))
}

/** Feeds records through one translator and collects everything it produced. */
function run(
  records: Record<string, unknown>[],
  input: { exitCode: number | null; stderr: string; failure?: string | null } = {
    exitCode: 0,
    stderr: '',
  },
) {
  const translator = new PiTranslator()
  const frames = records.flatMap((record) => translator.push(record).frames)
  return [...frames, ...translator.finish(input)]
}

describe('textOf', () => {
  it('joins text blocks and ignores thinking and images', () => {
    expect(
      textOf([
        { type: 'thinking', thinking: '想一下' },
        { type: 'text', text: '前半' },
        { type: 'image', data: 'AAAA', mimeType: 'image/png' },
        { type: 'text', text: '后半' },
      ]),
    ).toBe('前半后半')
  })
})

describe('PiTranslator', () => {
  it('turns one run into text, thinking, tools, usage and one closing frame', () => {
    const frames = run([
      { type: 'session', id: 'pi-1' },
      { type: 'turn_start' },
      { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: '想' } },
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
      { type: 'agent_end', messages: [] },
    ])

    expect(events(frames).map((event) => event.type)).toEqual([
      'tool/call',
      'tool/result',
      'assistant/message',
      'turn/end',
    ])
    expect(events(frames)[0]?.data).toEqual({
      name: 'bash',
      callId: 'c1',
      arguments: JSON.stringify({ command: 'echo hi' }),
    })
    expect(events(frames)[1]?.data).toEqual({
      message: { toolCallId: 'c1', isError: false, content: [{ type: 'text', text: 'hi\n' }] },
    })
    expect(events(frames)[3]?.data).toEqual({ reason: { kind: 'completed' } })

    expect(chunks(frames)).toEqual([
      { type: 'reasoning-delta', text: '想' },
      { type: 'text-delta', text: '等于' },
      { type: 'text-delta', text: ' 2' },
      { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
    ])
  })

  it('reads the session id Pi announces', () => {
    const translator = new PiTranslator()
    expect(translator.push({ type: 'session', id: 'pi-1' }).sessionId).toBe('pi-1')
    expect(translator.push({ type: 'session' }).sessionId).toBeUndefined()
  })

  it('ignores what is not part of the transcript', () => {
    const frames = run([
      { type: 'agent_start' },
      { type: 'turn_start' },
      { type: 'message_start', message: { role: 'user' } },
      { type: 'tool_execution_update', toolCallId: 'c1', partialResult: {} },
      { type: 'message_update', assistantMessageEvent: { type: 'toolcall_delta' } },
    ])

    // Only the closing frame: nothing was produced, so this run failed.
    expect(events(frames).map((event) => event.type)).toEqual(['turn/end'])
    expect(events(frames)[0]?.data).toMatchObject({ reason: { kind: 'error' } })
  })

  it('closes an empty run as a failure instead of a blank answer', () => {
    const frames = run([{ type: 'turn_end', message: { role: 'assistant', content: [] } }])

    expect(events(frames).map((event) => event.type)).toEqual(['turn/end'])
    expect(JSON.stringify(events(frames)[0]?.data)).toContain('没有返回任何内容')
  })

  it('reports an aborted run as cancelled, not failed', () => {
    const translator = new PiTranslator()
    translator.push({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: '半个' },
    })
    translator.cancel()

    const frames = translator.finish({ exitCode: 0, stderr: '' })
    expect(events(frames).map((event) => event.type)).toEqual(['turn/end'])
    expect(events(frames)[0]?.data).toEqual({ reason: { kind: 'aborted' } })
  })

  it('prefers the reason the caller already knows', () => {
    // A refused command never reached the model: its own message is the truth, not
    // "pi 没有返回任何内容".
    const frames = run([{ type: 'agent_start' }], {
      exitCode: 0,
      stderr: '',
      failure: 'pi 拒绝了这个命令：already streaming',
    })

    const end = events(frames).at(-1)
    expect(end?.data).toEqual({
      reason: { kind: 'error', error: { message: 'pi 拒绝了这个命令：already streaming' } },
    })
  })

  it('carries a retry note into the closing reason', () => {
    const frames = run([{ type: 'agent_end', willRetry: true }], { exitCode: 1, stderr: 'boom' })

    expect(JSON.stringify(events(frames).at(-1)?.data)).toContain('正在重试')
  })
})
