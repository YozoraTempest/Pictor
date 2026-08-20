import type { Page } from '@playwright/test'
import type { ServerResponse } from 'node:http'

import type { PictorBridge } from '../src/shared/desktop-bridge.js'

// Hidden Wayland windows do not produce the compositor frames Playwright needs for actionability.
process.env.PICTOR_E2E_HEADLESS = process.platform === 'win32' ? '1' : '0'

export const credentialFixtures = {
  storedSettings: ['pictor', 'e2e', 'secret'].join('-'),
  localRuntime: ['local', 'e2e', 'key'].join('-'),
  runtimeRecovery: ['recovery', 'e2e', 'key'].join('-'),
  responsesRuntime: ['responses', 'e2e', 'key'].join('-'),
  interruptedRun: ['interrupted', 'e2e', 'key'].join('-'),
}

export const bridgeKeys = [
  'approveCommand',
  'createSession',
  'deleteSession',
  'getAppInfo',
  'getPluginBootstrap',
  'getPluginManagerSnapshot',
  'getSession',
  'getSettings',
  'getSnapshot',
  'installLocalPlugin',
  'installPiExtension',
  'installPiPackage',
  'listModels',
  'queueRuntimeMessage',
  'pickProjectDirectory',
  'onRuntimeEvent',
  'registerProject',
  'relinkProject',
  'removePlugin',
  'removeProject',
  'respondToExtensionUi',
  'clearRuntimeQueue',
  'renameSession',
  'restoreBundledPlugin',
  'rejectCommand',
  'saveSettings',
  'selectContext',
  'setPluginEnabled',
  'startRun',
  'stopRun',
  'testSettings',
]

export const moduleBridgeKeys = ['invoke', 'onEvent']

export async function readSelectedRunStatus(window: Page): Promise<string | null> {
  return window.evaluate(async () => {
    const bridge = (globalThis as typeof globalThis & { pictor: PictorBridge }).pictor
    const snapshot = await bridge.getSnapshot()
    if (!snapshot.ok || !snapshot.value.selectedSessionId) return null
    const session = await bridge.getSession({ sessionId: snapshot.value.selectedSessionId })
    return session.ok ? (session.value.runs.at(-1)?.status ?? null) : null
  })
}

function writeResponsesEvents(response: ServerResponse, events: unknown[]): void {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    Connection: 'keep-alive',
    'Cache-Control': 'no-cache',
  })
  for (const event of events) response.write(`data: ${JSON.stringify(event)}\n\n`)
  response.end('data: [DONE]\n\n')
}

export function writeResponsesToolCall(
  response: ServerResponse,
  responseId: string,
  callId: string,
  name: string,
  args: Record<string, unknown>,
): void {
  const itemId = `fc_${callId}`
  const argumentsJson = JSON.stringify(args)
  const item = {
    id: itemId,
    type: 'function_call',
    status: 'completed',
    call_id: callId,
    name,
    arguments: argumentsJson,
  }
  writeResponsesEvents(response, [
    { type: 'response.created', response: { id: responseId, status: 'in_progress', output: [] } },
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: { ...item, status: 'in_progress', arguments: '' },
    },
    {
      type: 'response.function_call_arguments.delta',
      output_index: 0,
      item_id: itemId,
      delta: argumentsJson,
    },
    {
      type: 'response.function_call_arguments.done',
      output_index: 0,
      item_id: itemId,
      arguments: argumentsJson,
    },
    { type: 'response.output_item.done', output_index: 0, item },
    {
      type: 'response.completed',
      response: {
        id: responseId,
        status: 'completed',
        output: [item],
        usage: {
          input_tokens: 10,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: 5,
          output_tokens_details: { reasoning_tokens: 0 },
          total_tokens: 15,
        },
      },
    },
  ])
}

export function writeResponsesText(
  response: ServerResponse,
  responseId: string,
  value: string,
): void {
  const itemId = `msg_${responseId}`
  const item = {
    id: itemId,
    type: 'message',
    status: 'completed',
    role: 'assistant',
    content: [{ type: 'output_text', text: value, annotations: [], logprobs: [] }],
  }
  writeResponsesEvents(response, [
    { type: 'response.created', response: { id: responseId, status: 'in_progress', output: [] } },
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: { ...item, status: 'in_progress', content: [] },
    },
    {
      type: 'response.output_text.delta',
      output_index: 0,
      content_index: 0,
      item_id: itemId,
      delta: value,
      logprobs: [],
    },
    { type: 'response.output_item.done', output_index: 0, item },
    {
      type: 'response.completed',
      response: {
        id: responseId,
        status: 'completed',
        output: [item],
        usage: {
          input_tokens: 12,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: 8,
          output_tokens_details: { reasoning_tokens: 0 },
          total_tokens: 20,
        },
      },
    },
  ])
}

export function writeChatText(response: ServerResponse, value: string): void {
  response.writeHead(200, { 'Content-Type': 'text/event-stream' })
  response.write(
    `data: ${JSON.stringify({
      id: 'chatcmpl-runtime-recovery',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'pictor-e2e-model',
      choices: [{ index: 0, delta: { role: 'assistant', content: value }, finish_reason: null }],
    })}\n\n`,
  )
  response.write(
    `data: ${JSON.stringify({
      id: 'chatcmpl-runtime-recovery',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'pictor-e2e-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    })}\n\n`,
  )
  response.end('data: [DONE]\n\n')
}
