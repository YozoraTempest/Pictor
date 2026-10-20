import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'
import { mapPiEvent, toPiModel } from './pi-adapter.js'
import { EchoAgentRuntime, type AgentEvent } from './runtime.js'
import { projectSession } from './projection.js'

describe('EchoAgentRuntime', () => {
  it('streams a deterministic reply', async () => {
    const events: AgentEvent[] = []
    const runtime = new EchoAgentRuntime()

    await runtime.run({ runId: 'r1', prompt: 'hello', workingDirectory: '/tmp' }, (event) =>
      events.push(event),
    )
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(events).toEqual([
      { type: 'run.started', runId: 'r1' },
      { type: 'message.delta', runId: 'r1', text: 'Echo: hello' },
      { type: 'run.finished', runId: 'r1', reason: 'stop' },
    ])
  })

  it('reports cancellation', async () => {
    const events: AgentEvent[] = []
    const runtime = new EchoAgentRuntime()
    const handle = await runtime.run(
      { runId: 'r1', prompt: 'hello', workingDirectory: '/tmp' },
      (event) => events.push(event),
    )

    handle.cancel()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(events.at(-1)).toEqual({ type: 'run.finished', runId: 'r1', reason: 'cancelled' })
  })
})

describe('toPiModel', () => {
  it('maps chat-completions configuration', () => {
    const model = toPiModel({
      baseUrl: 'https://api.example.com/v1',
      modelId: 'demo',
      workingDirectory: '/tmp',
    })

    expect(model).toMatchObject({
      id: 'demo',
      api: 'openai-completions',
      baseUrl: 'https://api.example.com/v1',
    })
    expect(model).not.toHaveProperty('apiKey')
  })

  it('maps the responses protocol and includes the key when present', () => {
    const model = toPiModel({
      baseUrl: 'https://api.example.com/v1',
      modelId: 'demo',
      apiKey: 'secret',
      protocol: 'responses',
      workingDirectory: '/tmp',
    })

    expect(model).toMatchObject({ api: 'openai-responses', apiKey: 'secret' })
  })
})

describe('mapPiEvent', () => {
  it('maps text deltas', () => {
    expect(
      mapPiEvent('r1', {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'hi' },
      }),
    ).toEqual({ type: 'message.delta', runId: 'r1', text: 'hi' })
  })

  it('maps tool start and end', () => {
    expect(
      mapPiEvent('r1', { type: 'tool_execution_start', toolName: 'read', args: { path: 'a' } }),
    ).toMatchObject({ type: 'tool.started', tool: 'read' })

    expect(
      mapPiEvent('r1', {
        type: 'tool_execution_end',
        toolName: 'read',
        result: { content: [{ type: 'text', text: 'contents' }] },
        isError: false,
      }),
    ).toMatchObject({ type: 'tool.finished', output: 'contents', isError: false })
  })

  it('ignores unrelated events', () => {
    expect(mapPiEvent('r1', { type: 'turn_start' })).toBeNull()
    expect(mapPiEvent('r1', null)).toBeNull()
  })
})

describe('projectSession', () => {
  it('projects text messages from Pi JSONL', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pictor-projection-'))
    const path = join(directory, 'session.jsonl')
    writeFileSync(
      path,
      [
        JSON.stringify({
          type: 'message',
          timestamp: 1,
          message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        }),
        JSON.stringify({
          type: 'message',
          timestamp: 2,
          message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
        }),
        '{ broken json',
      ].join('\n'),
    )

    await expect(projectSession(path)).resolves.toEqual([
      { role: 'user', text: 'hello', timestamp: 1 },
      { role: 'assistant', text: 'hi', timestamp: 2 },
    ])
  })
  it('returns an empty projection for a missing file', async () => {
    await expect(projectSession('/definitely/missing.jsonl')).resolves.toEqual([])
  })
})
