// @vitest-environment node

import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, expect, it } from 'vitest'

import type { RuntimeEvent } from '../../src/shared/contracts.js'
import { PiAgentRuntime } from './pi-adapter.js'

let server: Server
let baseUrl: string
let testRoot: string

beforeEach(async () => {
  testRoot = await mkdtemp(join(tmpdir(), 'pictor-pi-runtime-'))
  await mkdir(join(testRoot, 'project'))
  server = createServer((_request, response) => {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      Connection: 'keep-alive',
      'Cache-Control': 'no-cache',
    })
    response.write(
      `data: ${JSON.stringify({
        id: 'chatcmpl-pictor',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'pictor-test-model',
        choices: [
          { index: 0, delta: { role: 'assistant', content: 'Hello from Pi' }, finish_reason: null },
        ],
      })}\n\n`,
    )
    response.write(
      `data: ${JSON.stringify({
        id: 'chatcmpl-pictor',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'pictor-test-model',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      })}\n\n`,
    )
    response.end('data: [DONE]\n\n')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server failed to bind')
  baseUrl = `http://127.0.0.1:${address.port}/v1`
})

afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
  await rm(testRoot, { recursive: true, force: true })
})

it('streams normalized text events through the real Pi SDK', async () => {
  const events: RuntimeEvent[] = []
  const runtime = new PiAgentRuntime((event) => events.push(event))
  await runtime.start({
    type: 'start',
    runId: '01234567-89ab-4def-8123-456789abcdef',
    sessionId: '11234567-89ab-4def-8123-456789abcdef',
    messageId: '21234567-89ab-4def-8123-456789abcdef',
    projectRoot: join(testRoot, 'project'),
    agentDirectory: join(testRoot, 'agent'),
    sessionDirectory: join(testRoot, 'session'),
    settings: {
      baseUrl,
      modelId: 'pictor-test-model',
      temperature: 0.1,
      maxOutputTokens: 64,
    },
    apiKey: 'local-test-key',
    prompt: 'Say hello.',
  })

  expect(events).toContainEqual(
    expect.objectContaining({ type: 'message.delta', delta: 'Hello from Pi' }),
  )
  expect(events).toContainEqual(
    expect.objectContaining({ type: 'message.completed', content: 'Hello from Pi' }),
  )
  expect(events.at(-1)).toEqual(
    expect.objectContaining({ type: 'run.stateChanged', status: 'completed' }),
  )
}, 20_000)
