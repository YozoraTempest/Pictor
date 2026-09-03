import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page,
  type TestInfo,
} from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { resolve } from 'node:path'

import { defaultPluginProfile } from '../src/main/plugins/default-profile.js'
import { PluginStore } from '../src/main/plugins/plugin-store.js'
import { closeElectronApp } from './electron-cleanup.js'
import { credentialFixtures, invokeAgentWorkspace } from './support.js'

type ExtensionTool = 'hello' | 'ask_gui'

interface PiExtensionHarness {
  electronApp: ElectronApplication
  window: Page
  queueToolCall(tool: ExtensionTool): void
  startSelectedRun(prompt: string): Promise<unknown>
}

function writeToolCall(response: ServerResponse, tool: ExtensionTool): void {
  const callId = tool === 'hello' ? 'call-native-hello' : 'call-extension-ui'
  const toolArguments = tool === 'hello' ? { name: 'Pictor' } : {}
  response.write(
    `data: ${JSON.stringify({
      id: 'chatcmpl-extension-tool',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'pictor-e2e-model',
      choices: [
        {
          index: 0,
          delta: {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: callId,
                type: 'function',
                function: { name: tool, arguments: JSON.stringify(toolArguments) },
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
      id: 'chatcmpl-extension-tool',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'pictor-e2e-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
    })}\n\n`,
  )
}

function writeText(response: ServerResponse): void {
  response.write(
    `data: ${JSON.stringify({
      id: 'chatcmpl-extension-result',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'pictor-e2e-model',
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', content: 'Native extension completed.' },
          finish_reason: null,
        },
      ],
    })}\n\n`,
  )
  response.write(
    `data: ${JSON.stringify({
      id: 'chatcmpl-extension-result',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'pictor-e2e-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    })}\n\n`,
  )
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  )
}

async function createHarness(testInfo: TestInfo) {
  const queuedToolCalls: ExtensionTool[] = []
  const server = createServer(async (request, response) => {
    for await (const chunk of request) void chunk
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const tool = queuedToolCalls.shift()
    if (tool) writeToolCall(response, tool)
    else writeText(response)
    response.end('data: [DONE]\n\n')
  })
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  const address = server.address()
  if (!address || typeof address === 'string') {
    await closeServer(server)
    throw new Error('E2E model server failed to bind')
  }

  const userDataDirectory = testInfo.outputPath('user-data')
  const projectRoot = testInfo.outputPath('project')
  const guiExtension = testInfo.outputPath('gui-extension.ts')
  let electronApp: ElectronApplication | null = null

  try {
    await mkdir(projectRoot, { recursive: true })
    await writeFile(
      guiExtension,
      `import { Type } from 'typebox'
export default function (pi) {
  pi.registerTool({
    name: 'ask_gui',
    label: 'Ask GUI',
    description: 'Ask through the Pictor GUI',
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _update, ctx) {
      const value = await ctx.ui.input('Enter a value', 'type something...')
      return { content: [{ type: 'text', text: String(value ?? 'cancelled') }], details: {} }
    },
  })
}
`,
    )

    const store = new PluginStore({
      userDataDirectory,
      bundledPluginsDirectory: resolve('.pictor/bundled-plugins'),
      profile: defaultPluginProfile,
    })
    await store.initialize()
    await store.installPiExtension(
      resolve('node_modules/@earendil-works/pi-coding-agent/examples/extensions/hello.ts'),
    )
    await store.installPiExtension(guiExtension)

    electronApp = await electron.launch({
      args: [resolve('out/main/index.js'), `--user-data-dir=${userDataDirectory}`],
      cwd: resolve('.'),
    })
    const window = await electronApp.firstWindow()
    await window.getByRole('heading', { name: '选择一个项目开始' }).waitFor()
    const settings = await invokeAgentWorkspace(window, 'saveSettings', {
      apiProtocol: 'chat-completions',
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      modelId: 'pictor-e2e-model',
      reasoningEffort: null,
      temperature: null,
      maxOutputTokens: null,
      apiKey: { action: 'replace', value: credentialFixtures.localRuntime },
    })
    const project = await invokeAgentWorkspace(window, 'registerProject', {
      rootPath: projectRoot,
      trusted: true,
    })
    const session = project.ok
      ? await invokeAgentWorkspace(window, 'createSession', { projectId: project.value.id })
      : null
    if (!settings.ok || !project.ok || !session?.ok) {
      throw new Error('Pi Extension E2E setup failed')
    }
    await window.reload()
    await expect
      .poll(
        () =>
          invokeAgentWorkspace(window, 'selectContext', {
            projectId: project.value.id,
            sessionId: session.value.id,
          }).then((selection) => selection.ok),
        { timeout: 30_000 },
      )
      .toBe(true)

    const harness: PiExtensionHarness = {
      electronApp,
      window,
      queueToolCall: (tool) => queuedToolCalls.push(tool),
      startSelectedRun: (prompt) =>
        invokeAgentWorkspace(window, 'startRun', {
          sessionId: session.value.id,
          prompt,
        }),
    }
    return { harness, server }
  } catch (error) {
    if (electronApp) await closeElectronApp(electronApp, { mode: 'suppress' })
    await closeServer(server)
    throw error
  }
}

export const test = base.extend<{ piExtension: PiExtensionHarness }>({
  piExtension: async ({ browserName: _browserName }, provide, testInfo) => {
    const { harness, server } = await createHarness(testInfo)
    let businessFailed = false
    try {
      await provide(harness)
    } catch (error) {
      businessFailed = true
      throw error
    } finally {
      try {
        await closeElectronApp(harness.electronApp, {
          mode: businessFailed ? 'suppress' : 'strict',
        })
      } finally {
        await closeServer(server)
      }
    }
  },
})

export { expect }
