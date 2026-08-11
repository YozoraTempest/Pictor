// @vitest-environment node

import { randomUUID } from 'node:crypto'
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
let lastRequestBody: Record<string, unknown>
let failureMode: 'success' | 'authentication' | 'server' | 'malformed' | 'disconnect'

beforeEach(async () => {
  testRoot = await mkdtemp(join(tmpdir(), 'pictor-pi-runtime-'))
  await mkdir(join(testRoot, 'project'))
  lastRequestBody = {}
  failureMode = 'success'
  server = createServer(async (request, response) => {
    let requestBody = ''
    for await (const chunk of request) requestBody += chunk.toString()
    lastRequestBody = JSON.parse(requestBody) as Record<string, unknown>
    const isResponses = request.url === '/v1/responses'
    if (failureMode === 'authentication' || failureMode === 'server') {
      const status = failureMode === 'authentication' ? 401 : isResponses ? 503 : 429
      response.writeHead(status, { 'Content-Type': 'application/json' })
      response.end(
        JSON.stringify({
          error: {
            message:
              failureMode === 'authentication'
                ? 'Invalid API key'
                : 'Model service is temporarily unavailable',
          },
        }),
      )
      return
    }
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      Connection: 'keep-alive',
      'Cache-Control': 'no-cache',
    })
    if (failureMode === 'malformed') {
      response.end('data: {not-valid-json}\n\n')
      return
    }
    if (failureMode === 'disconnect') {
      response.write(
        isResponses
          ? `data: ${JSON.stringify({
              type: 'response.created',
              response: { id: 'resp_interrupted', status: 'in_progress', output: [] },
            })}\n\n`
          : `data: ${JSON.stringify({
              id: 'chatcmpl-interrupted',
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: 'pictor-test-model',
              choices: [
                {
                  index: 0,
                  delta: { role: 'assistant', content: 'Partial output' },
                  finish_reason: null,
                },
              ],
            })}\n\n`,
      )
      response.socket?.destroy(new Error('Simulated mid-stream disconnect'))
      return
    }
    if (isResponses) {
      const responseId = 'resp_pictor'
      const messageId = 'msg_pictor'
      const events = [
        {
          type: 'response.created',
          response: { id: responseId, status: 'in_progress', output: [] },
        },
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: {
            id: messageId,
            type: 'message',
            status: 'in_progress',
            role: 'assistant',
            content: [],
          },
        },
        {
          type: 'response.output_text.delta',
          output_index: 0,
          content_index: 0,
          item_id: messageId,
          delta: 'Hello from Responses',
          logprobs: [],
        },
        {
          type: 'response.output_item.done',
          output_index: 0,
          item: {
            id: messageId,
            type: 'message',
            status: 'completed',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: 'Hello from Responses',
                annotations: [],
                logprobs: [],
              },
            ],
          },
        },
        {
          type: 'response.completed',
          response: {
            id: responseId,
            status: 'completed',
            output: [],
            usage: {
              input_tokens: 1,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens: 3,
              output_tokens_details: { reasoning_tokens: 0 },
              total_tokens: 4,
            },
          },
        },
      ]
      for (const event of events) response.write(`data: ${JSON.stringify(event)}\n\n`)
      response.end('data: [DONE]\n\n')
      return
    }

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

async function runAgent(
  runtime: PiAgentRuntime,
  protocol: 'chat-completions' | 'responses',
  prompt: string,
): Promise<void> {
  const directoryId = randomUUID()
  await runtime.start({
    type: 'start',
    runId: randomUUID(),
    sessionId: randomUUID(),
    messageId: randomUUID(),
    projectRoot: join(testRoot, 'project'),
    agentDirectory: join(testRoot, `agent-${directoryId}`),
    sessionDirectory: join(testRoot, `session-${directoryId}`),
    settings: {
      apiProtocol: protocol,
      baseUrl,
      modelId: 'pictor-test-model',
      reasoningEffort: null,
      temperature: null,
      maxOutputTokens: 64,
    },
    apiKey: 'local-test-key',
    prompt,
  })
}

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
      apiProtocol: 'chat-completions',
      baseUrl,
      modelId: 'pictor-test-model',
      reasoningEffort: 'high',
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
  expect(lastRequestBody.reasoning_effort).toBe('high')
}, 20_000)

it('streams Responses API events through the real Pi SDK', async () => {
  const events: RuntimeEvent[] = []
  const runtime = new PiAgentRuntime((event) => events.push(event))
  await runtime.start({
    type: 'start',
    runId: '31234567-89ab-4def-8123-456789abcdef',
    sessionId: '41234567-89ab-4def-8123-456789abcdef',
    messageId: '51234567-89ab-4def-8123-456789abcdef',
    projectRoot: join(testRoot, 'project'),
    agentDirectory: join(testRoot, 'agent-responses'),
    sessionDirectory: join(testRoot, 'session-responses'),
    settings: {
      apiProtocol: 'responses',
      baseUrl,
      modelId: 'pictor-test-model',
      reasoningEffort: 'xhigh',
      temperature: null,
      maxOutputTokens: 64,
    },
    apiKey: 'local-test-key',
    prompt: 'Say hello.',
  })

  expect(events).toContainEqual(
    expect.objectContaining({ type: 'message.delta', delta: 'Hello from Responses' }),
  )
  expect(events).toContainEqual(
    expect.objectContaining({
      type: 'message.completed',
      content: 'Hello from Responses',
    }),
  )
  expect(events.at(-1)).toEqual(
    expect.objectContaining({ type: 'run.stateChanged', status: 'completed' }),
  )
  expect(lastRequestBody.reasoning).toEqual(expect.objectContaining({ effort: 'xhigh' }))
}, 20_000)

it.each([
  ['chat-completions', 'authentication', 'authentication', '模型认证失败'],
  ['responses', 'authentication', 'authentication', '模型认证失败'],
  ['chat-completions', 'server', 'server', '模型服务暂时不可用或请求受限'],
  ['responses', 'server', 'server', '模型服务暂时不可用或请求受限'],
  ['chat-completions', 'malformed', 'runtime', '模型响应无法处理'],
  ['responses', 'malformed', 'runtime', '模型响应无法处理'],
  ['chat-completions', 'disconnect', 'connectivity', '模型连接中断'],
  ['responses', 'disconnect', 'connectivity', '模型连接中断'],
] as const)(
  'fails a %s Agent run for %s and accepts a recovery run',
  async (protocol, mode, category, readableMessage) => {
    const events: RuntimeEvent[] = []
    const runtime = new PiAgentRuntime((event) => events.push(event))
    failureMode = mode

    await runAgent(runtime, protocol, `Trigger ${mode}.`)

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'runtime.error',
        category,
        message: expect.stringContaining(readableMessage),
      }),
    )
    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: 'run.stateChanged',
        status: 'failed',
        error: expect.stringContaining(readableMessage),
      }),
    )

    const recoveryEventStart = events.length
    failureMode = 'success'
    await runAgent(runtime, protocol, 'Recover after the model failure.')
    expect(events.slice(recoveryEventStart).at(-1)).toEqual(
      expect.objectContaining({ type: 'run.stateChanged', status: 'completed' }),
    )
  },
  20_000,
)
