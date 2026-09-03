import type { Page } from '@playwright/test'
import type { ServerResponse } from 'node:http'
import type { z } from 'zod'

import type { ModuleTransport } from '../src/kernel/contract.js'
import { agentWorkspaceContract } from '../src/modules/agent-workspace/shared.js'

export const credentialFixtures = {
  localRuntime: ['local', 'e2e', 'key'].join('-'),
  interruptedRun: ['interrupted', 'e2e', 'key'].join('-'),
}

export const bridgeKeys = [
  'commands',
  'getAppInfo',
  'getPluginBootstrap',
  'notifyGuiReady',
  'pickPlugin',
  'pickProjectDirectory',
  'pickSessionImport',
  'pickSessionExport',
  'pickMessageImages',
]

export const moduleBridgeKeys = ['invoke', 'onEvent']

type WorkspaceMethod = keyof typeof agentWorkspaceContract.methods & string
type WorkspaceMethodInput<Method extends WorkspaceMethod> = z.input<
  (typeof agentWorkspaceContract.methods)[Method]['input']
>
type WorkspaceMethodOutput<Method extends WorkspaceMethod> = z.output<
  (typeof agentWorkspaceContract.methods)[Method]['output']
>

export async function invokeAgentWorkspace<Method extends WorkspaceMethod>(
  window: Page,
  method: Method,
  input: WorkspaceMethodInput<Method>,
): Promise<WorkspaceMethodOutput<Method>> {
  const output = await window.evaluate(
    ({ moduleId, methodName, methodInput }) => {
      const transport = (globalThis as typeof globalThis & { pictorModules: ModuleTransport })
        .pictorModules
      return transport.invoke(moduleId, methodName, methodInput)
    },
    { moduleId: agentWorkspaceContract.id, methodName: method, methodInput: input },
  )
  return agentWorkspaceContract.methods[method].output.parse(
    output,
  ) as WorkspaceMethodOutput<Method>
}

export async function readSelectedRunStatus(window: Page): Promise<string | null> {
  const snapshot = await invokeAgentWorkspace(window, 'getSnapshot', null)
  if (!snapshot.ok || !snapshot.value.selectedSessionId) return null
  const session = await invokeAgentWorkspace(window, 'getSession', {
    sessionId: snapshot.value.selectedSessionId,
  })
  return session.ok ? (session.value.runs.at(-1)?.status ?? null) : null
}

export function writeChatText(response: ServerResponse, value: string): void {
  response.writeHead(200, { 'Content-Type': 'text/event-stream' })
  response.write(
    `data: ${JSON.stringify({
      id: 'chatcmpl-e2e',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'pictor-e2e-model',
      choices: [{ index: 0, delta: { role: 'assistant', content: value }, finish_reason: null }],
    })}\n\n`,
  )
  response.write(
    `data: ${JSON.stringify({
      id: 'chatcmpl-e2e',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'pictor-e2e-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    })}\n\n`,
  )
  response.end('data: [DONE]\n\n')
}
