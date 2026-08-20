// @vitest-environment node

import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, expect, it } from 'vitest'

import { SessionManager } from '@earendil-works/pi-coding-agent'

import type { RuntimeEvent } from '../shared/runtime-protocol.js'
import { openAiCompatibleModelProvider } from './openai-model-provider.js'
import { PiAgentRuntime } from './pi-adapter.js'

let server: Server
let baseUrl: string
let testRoot: string
let lastRequestBody: Record<string, unknown>
let failureMode: 'success' | 'authentication' | 'server' | 'malformed' | 'disconnect'
let chatResponseText: string
let chatToolArguments: Record<string, string> | null
let chatToolName: string
let chatToolCallId: string
let chatRequestCount: number
const localApiKey = ['local', 'test', 'key'].join('-')

function createRuntime(emit: (event: RuntimeEvent) => void): PiAgentRuntime {
  const runtime = new PiAgentRuntime(emit)
  runtime.configure({
    extensionPaths: [],
    skillPaths: [],
    promptPaths: [],
    modelProviders: [openAiCompatibleModelProvider],
  })
  return runtime
}

beforeEach(async () => {
  testRoot = await mkdtemp(join(tmpdir(), 'pictor-pi-runtime-'))
  await mkdir(join(testRoot, 'project'))
  lastRequestBody = {}
  failureMode = 'success'
  chatResponseText = 'Hello from Pi'
  chatToolArguments = null
  chatToolName = 'pictor_write'
  chatToolCallId = 'call-pictor-redaction'
  chatRequestCount = 0
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

    chatRequestCount += 1
    if (chatToolArguments && chatRequestCount === 1) {
      response.write(
        `data: ${JSON.stringify({
          id: 'chatcmpl-pictor-tool',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'pictor-test-model',
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [
                  {
                    index: 0,
                    id: chatToolCallId,
                    type: 'function',
                    function: {
                      name: chatToolName,
                      arguments: JSON.stringify(chatToolArguments),
                    },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        })}\n\n`,
      )
      response.write(
        `data: ${JSON.stringify({
          id: 'chatcmpl-pictor-tool',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'pictor-test-model',
          choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
        })}\n\n`,
      )
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
          {
            index: 0,
            delta: { role: 'assistant', content: chatResponseText },
            finish_reason: null,
          },
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
    resumeSession: true,
    settings: {
      apiProtocol: protocol,
      baseUrl,
      modelId: 'pictor-test-model',
      reasoningEffort: null,
      temperature: null,
      maxOutputTokens: 64,
    },
    apiKey: localApiKey,
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
  const runtime = createRuntime((event) => events.push(event))
  await runtime.start({
    type: 'start',
    runId: '01234567-89ab-4def-8123-456789abcdef',
    sessionId: '11234567-89ab-4def-8123-456789abcdef',
    messageId: '21234567-89ab-4def-8123-456789abcdef',
    projectRoot: join(testRoot, 'project'),
    agentDirectory: join(testRoot, 'agent'),
    sessionDirectory: join(testRoot, 'session'),
    resumeSession: true,
    settings: {
      apiProtocol: 'chat-completions',
      baseUrl,
      modelId: 'pictor-test-model',
      reasoningEffort: 'high',
      temperature: 0.1,
      maxOutputTokens: 64,
    },
    apiKey: localApiKey,
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
  const runtime = createRuntime((event) => events.push(event))
  await runtime.start({
    type: 'start',
    runId: '31234567-89ab-4def-8123-456789abcdef',
    sessionId: '41234567-89ab-4def-8123-456789abcdef',
    messageId: '51234567-89ab-4def-8123-456789abcdef',
    projectRoot: join(testRoot, 'project'),
    agentDirectory: join(testRoot, 'agent-responses'),
    sessionDirectory: join(testRoot, 'session-responses'),
    resumeSession: true,
    settings: {
      apiProtocol: 'responses',
      baseUrl,
      modelId: 'pictor-test-model',
      reasoningEffort: 'xhigh',
      temperature: null,
      maxOutputTokens: 64,
    },
    apiKey: localApiKey,
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

it('loads an unmodified official Pi Extension and exposes its custom tool', async () => {
  const events: RuntimeEvent[] = []
  chatToolName = 'hello'
  chatToolCallId = 'call-official-hello'
  chatToolArguments = { name: 'Pictor' }
  const runtime = createRuntime((event) => events.push(event))
  runtime.configure({
    extensionPaths: [
      resolve('node_modules/@earendil-works/pi-coding-agent/examples/extensions/hello.ts'),
    ],
    skillPaths: [],
    promptPaths: [],
    modelProviders: [openAiCompatibleModelProvider],
  })

  await runAgent(runtime, 'chat-completions', 'Use the hello tool.')

  expect(events).toContainEqual(
    expect.objectContaining({
      type: 'tool.started',
      callId: 'call-official-hello',
      kind: 'custom',
      label: 'hello',
    }),
  )
  expect(events).toContainEqual(
    expect.objectContaining({
      type: 'tool.completed',
      callId: 'call-official-hello',
      output: 'Hello, Pictor!',
      isError: false,
    }),
  )
}, 20_000)

it('does not auto-load project Pi Extensions without explicit project authorization', async () => {
  const projectExtensionDirectory = join(testRoot, 'project', '.pi', 'extensions')
  await mkdir(projectExtensionDirectory, { recursive: true })
  await writeFile(
    join(projectExtensionDirectory, 'project-only.ts'),
    `export default function (pi) {
  pi.registerTool({
    name: 'project_only',
    label: 'Project only',
    description: 'Must remain disabled',
    parameters: { type: 'object', properties: {} },
    async execute() { return { content: [{ type: 'text', text: 'unexpected' }], details: {} } },
  })
}
`,
  )
  chatToolName = 'project_only'
  chatToolCallId = 'call-project-only'
  chatToolArguments = {}
  const events: RuntimeEvent[] = []
  const runtime = createRuntime((event) => events.push(event))
  runtime.configure({
    extensionPaths: [
      resolve('node_modules/@earendil-works/pi-coding-agent/examples/extensions/hello.ts'),
    ],
    skillPaths: [],
    promptPaths: [],
    modelProviders: [openAiCompatibleModelProvider],
  })

  await runAgent(runtime, 'chat-completions', 'Do not load project code.')

  expect(events).toContainEqual(
    expect.objectContaining({
      type: 'tool.completed',
      callId: 'call-project-only',
      output: 'Tool project_only not found',
      isError: true,
    }),
  )
}, 20_000)

it.each(['a', 'id', 'running', ['pi', 'transcript', 'credential'].join('-')])(
  'redacts configured credential %s from real Pi transcripts and emitted events',
  async (secret) => {
    const sessionDirectory = join(testRoot, 'credential-session')
    const events: RuntimeEvent[] = []
    chatResponseText = `assistant echoed ${secret}`
    chatToolArguments = {
      path: 'x.txt',
      content: 'fixture',
      id: secret,
      status: secret,
      model: secret,
      type: secret,
      role: secret,
      name: secret,
    }
    const runtime = createRuntime((event) => events.push(event))

    await runtime.start({
      type: 'start',
      runId: randomUUID(),
      sessionId: randomUUID(),
      messageId: randomUUID(),
      projectRoot: join(testRoot, 'project'),
      agentDirectory: join(testRoot, 'credential-agent'),
      sessionDirectory,
      resumeSession: true,
      settings: {
        apiProtocol: 'chat-completions',
        baseUrl,
        modelId: 'pictor-test-model',
        reasoningEffort: null,
        temperature: null,
        maxOutputTokens: 64,
      },
      apiKey: secret,
      prompt: `user included ${secret}`,
    })

    const transcriptFiles = (await readdir(sessionDirectory)).filter((name) =>
      name.endsWith('.jsonl'),
    )
    expect(transcriptFiles).toHaveLength(1)
    const transcriptPath = join(sessionDirectory, transcriptFiles[0]!)
    const transcript = await readFile(transcriptPath, 'utf8')
    if (secret.length > 'running'.length) {
      expect(transcript).not.toContain(secret)
      expect(JSON.stringify(events)).not.toContain(secret)
    }
    expect(transcript).toContain('[REDACTED]')
    const transcriptEntries = transcript
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(transcriptEntries).toContainEqual(
      expect.objectContaining({
        type: 'message',
        message: expect.objectContaining({
          role: 'assistant',
          content: expect.arrayContaining([
            expect.objectContaining({
              type: 'toolCall',
              id: 'call-pictor-redaction',
              name: 'pictor_write',
              arguments: {
                path: 'x.txt',
                content: 'fixture',
                id: '[REDACTED]',
                status: '[REDACTED]',
                model: '[REDACTED]',
                type: '[REDACTED]',
                role: '[REDACTED]',
                name: '[REDACTED]',
              },
            }),
          ]),
        }),
      }),
    )
    const completed = events.find((event) => event.type === 'message.completed')
    expect(completed).toEqual(expect.objectContaining({ type: 'message.completed' }))
    if (!completed || completed.type !== 'message.completed') {
      throw new Error('Missing completed message event')
    }
    expect(completed.content).not.toContain(secret)
    expect(completed.content).toContain('[REDACTED]')
    const resumedTranscript = SessionManager.open(transcriptPath)
    expect(resumedTranscript.getHeader()).toMatchObject({ type: 'session', version: 3 })
    expect(resumedTranscript.getEntries().length).toBeGreaterThanOrEqual(3)
    expect(() => resumedTranscript.buildSessionContext()).not.toThrow()
  },
  20_000,
)

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
    const runtime = createRuntime((event) => events.push(event))
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
