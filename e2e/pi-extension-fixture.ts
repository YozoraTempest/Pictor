import {
  _electron as electron,
  test as base,
  expect,
  type ElectronApplication,
  type Page,
  type TestInfo,
} from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { basename, resolve } from 'node:path'

import type { ModuleTransport } from '../src/kernel/contract.js'
import { defaultPluginProfile } from '../src/main/plugins/default-profile.js'
import { PluginStore } from '../src/main/plugins/plugin-store.js'
import { agentWorkspaceContract } from '../src/modules/agent-workspace/shared.js'
import { credentialFixtures, invokeAgentWorkspace } from './support.js'

type ExtensionTool = 'hello' | 'ask_gui'

interface SessionMetadata {
  path: string
  history: {
    piSessionPath: string
    activeLeafId?: string | null
    runtimePreferences?: Record<string, unknown>
  }
}

export interface ImportedSessionContext extends SessionMetadata {
  sessionId: string
}

export interface PiExtensionHarness {
  electronApp: ElectronApplication
  window: Page
  userDataDirectory: string
  projectRoot: string
  projectName: string
  sessionId: string
  imageFixture: string
  importSource: string
  importedJsonl: string
  queueToolCall(tool: ExtensionTool): void
  startSelectedRun(prompt: string): Promise<unknown>
  importSession(): Promise<ImportedSessionContext>
  selectedSessionMetadata(): Promise<SessionMetadata>
  recordRuntimeEvents(sessionId: string): Promise<void>
  clearRuntimeEvents(): Promise<void>
  runtimeEvents(): Promise<Array<Record<string, unknown>>>
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

async function closeElectronApp(app: ElectronApplication): Promise<void> {
  await app
    .evaluate(({ dialog }) => {
      dialog.showMessageBoxSync = () => 1
    })
    .catch(() => undefined)
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      app.close(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Electron fixture did not exit')), 5_000)
      }),
    ])
  } catch {
    app.process().kill('SIGKILL')
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function importedSessionJsonl(): string {
  const assistantMessage = (content: string) => ({
    role: 'assistant',
    content: [{ type: 'text', text: content }],
    api: 'openai-completions',
    provider: 'pictor-openai-compatible',
    model: 'pictor-e2e-model',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
  })
  return [
    JSON.stringify({
      type: 'session',
      version: 3,
      id: 'imported-pi-session',
      timestamp: new Date().toISOString(),
      cwd: '/missing/import-project',
    }),
    JSON.stringify({
      type: 'message',
      id: 'imported-user',
      parentId: null,
      timestamp: new Date().toISOString(),
      message: { role: 'user', content: 'Imported root task' },
    }),
    JSON.stringify({
      type: 'custom_message',
      id: 'imported-large-context',
      parentId: 'imported-user',
      timestamp: new Date().toISOString(),
      customType: 'e2e-large-context',
      content: 'context '.repeat(12_000),
      display: false,
    }),
    JSON.stringify({
      type: 'message',
      id: 'imported-original',
      parentId: 'imported-large-context',
      timestamp: new Date().toISOString(),
      message: assistantMessage('Imported original answer'),
    }),
    JSON.stringify({
      type: 'message',
      id: 'imported-branch-user',
      parentId: 'imported-large-context',
      timestamp: new Date().toISOString(),
      message: { role: 'user', content: 'Imported branch task' },
    }),
    JSON.stringify({
      type: 'message',
      id: 'imported-branch-answer',
      parentId: 'imported-branch-user',
      timestamp: new Date().toISOString(),
      message: assistantMessage('Imported branch answer'),
    }),
    '',
  ].join('\n')
}

async function writeExtensions(projectRoot: string, outputPath: (name: string) => string) {
  const projectExtensionDirectory = resolve(projectRoot, '.pi', 'extensions')
  await mkdir(projectExtensionDirectory, { recursive: true })
  await writeFile(
    resolve(projectExtensionDirectory, 'project-note.ts'),
    `export default function (pi) {
  pi.registerCommand('project-note', {
    description: 'Project Extension command',
    handler: async () => pi.sendMessage({ customType: 'project-note', content: 'Project Extension loaded', display: true, details: {} }),
  })
}
`,
  )

  const guiExtension = outputPath('gui-extension.ts')
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
      await new Promise((resolve) => setTimeout(resolve, 1_000))
      return { content: [{ type: 'text', text: String(value ?? 'cancelled') }], details: {} }
    },
  })
}
`,
  )

  const lifecycleExtension = outputPath('fork-lifecycle-extension.ts')
  await writeFile(
    lifecycleExtension,
    `import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
export default function (pi) {
  pi.registerCommand('e2e-note', {
    description: 'Append a visible Extension note',
    handler: async (args) => {
      pi.sendMessage({ customType: 'e2e-note', content: 'Extension note: ' + args, display: true, details: {} })
      pi.appendEntry('e2e-command-state', { args })
    },
  })
  pi.registerCommand('e2e-user', {
    description: 'Send a User Message from an Extension',
    handler: async () => pi.sendUserMessage('Extension-originated user message'),
  })
  const record = (ctx, value) => appendFileSync(join(ctx.cwd, 'fork-lifecycle.log'), value + '\\n')
  pi.on('session_before_fork', (event, ctx) => record(ctx, 'before_fork:' + event.entryId + ':' + event.position))
  pi.on('session_before_switch', (_event, ctx) => record(ctx, 'before_switch'))
  pi.on('session_before_tree', (event, ctx) => {
    record(ctx, 'before_tree:' + event.preparation.targetId + ':' + event.preparation.oldLeafId + ':' + (event.preparation.customInstructions || ''))
    if (event.preparation.userWantsSummary) return { summary: { summary: 'E2E branch summary' } }
  })
  pi.on('session_tree', (event, ctx) => record(ctx, 'tree:' + event.oldLeafId + ':' + event.newLeafId))
  pi.on('session_before_compact', (event, ctx) => {
    record(ctx, 'before_compact:' + event.reason + ':' + (event.customInstructions || ''))
    if (event.customInstructions === 'Cancel E2E compaction') return { cancel: true }
    return { compaction: { summary: 'E2E compacted context', firstKeptEntryId: event.preparation.firstKeptEntryId, tokensBefore: event.preparation.tokensBefore } }
  })
  pi.on('session_compact', (event, ctx) => record(ctx, 'compact:' + event.reason + ':' + event.compactionEntry.summary))
  pi.on('session_shutdown', (event, ctx) => record(ctx, 'shutdown:' + event.reason))
  pi.on('session_start', (event, ctx) => record(ctx, 'start:' + event.reason))
}
`,
  )
  return { guiExtension, lifecycleExtension }
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
  const projectName = basename(projectRoot)
  const imageFixture = testInfo.outputPath('fixture.png')
  const importSource = testInfo.outputPath('import-source.jsonl')
  const importedJsonl = importedSessionJsonl()
  let electronApp: ElectronApplication | null = null

  try {
    await mkdir(projectRoot, { recursive: true })
    const extensions = await writeExtensions(projectRoot, (name) => testInfo.outputPath(name))
    await writeFile(
      imageFixture,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z6i0AAAAASUVORK5CYII=',
        'base64',
      ),
    )
    await writeFile(importSource, importedJsonl)

    const store = new PluginStore({
      userDataDirectory,
      bundledPluginsDirectory: resolve('.pictor/bundled-plugins'),
      profile: defaultPluginProfile,
    })
    await store.initialize()
    await store.installPiExtension(
      resolve('node_modules/@earendil-works/pi-coding-agent/examples/extensions/hello.ts'),
    )
    await store.installPiExtension(extensions.guiExtension)
    await store.installPiExtension(extensions.lifecycleExtension)

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
        async () =>
          (
            await invokeAgentWorkspace(window, 'selectContext', {
              projectId: project.value.id,
              sessionId: session.value.id,
            })
          ).ok,
        { timeout: 30_000 },
      )
      .toBe(true)

    const selectedSessionMetadata = async (): Promise<SessionMetadata> => {
      const snapshot = await invokeAgentWorkspace(window, 'getSnapshot', null)
      if (!snapshot.ok || !snapshot.value.selectedSessionId) {
        throw new Error('No selected Pictor Session')
      }
      const path = resolve(
        userDataDirectory,
        'data-v1',
        'sessions',
        `${snapshot.value.selectedSessionId}.json`,
      )
      const metadata = JSON.parse(await readFile(path, 'utf8')) as Omit<SessionMetadata, 'path'>
      if (!metadata.history.piSessionPath) throw new Error('Selected Session has no Pi authority')
      return { path, history: metadata.history }
    }

    const harness: PiExtensionHarness = {
      electronApp,
      window,
      userDataDirectory,
      projectRoot,
      projectName,
      sessionId: session.value.id,
      imageFixture,
      importSource,
      importedJsonl,
      queueToolCall: (tool) => queuedToolCalls.push(tool),
      startSelectedRun: async (prompt) => {
        const snapshot = await invokeAgentWorkspace(window, 'getSnapshot', null)
        if (!snapshot.ok || !snapshot.value.selectedSessionId) return null
        return invokeAgentWorkspace(window, 'startRun', {
          sessionId: snapshot.value.selectedSessionId,
          prompt,
        })
      },
      importSession: async () => {
        await electronApp?.evaluate(({ dialog }, sourcePath) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [sourcePath] })
        }, importSource)
        await window.getByLabel(`${projectName} 项目操作`).click()
        await window.getByRole('button', { name: '导入 Pi Session' }).click()
        await window.getByRole('heading', { name: 'import-source (Import)' }).waitFor()
        const snapshot = await invokeAgentWorkspace(window, 'getSnapshot', null)
        if (!snapshot.ok || !snapshot.value.selectedSessionId) {
          throw new Error('Imported Pictor Session is not selected')
        }
        const metadata = await selectedSessionMetadata()
        return { ...metadata, sessionId: snapshot.value.selectedSessionId }
      },
      selectedSessionMetadata,
      recordRuntimeEvents: (sessionId) =>
        window.evaluate(
          ({ eventName, moduleId, selectedSessionId }) => {
            const target = globalThis as typeof globalThis & {
              pictorModules: ModuleTransport
              __pictorRuntimeEvents?: unknown[]
            }
            target.__pictorRuntimeEvents = []
            target.pictorModules.onEvent(moduleId, eventName, (event) => {
              if (
                event &&
                typeof event === 'object' &&
                Reflect.get(event, 'sessionId') === selectedSessionId
              ) {
                target.__pictorRuntimeEvents?.push(event)
              }
            })
          },
          {
            eventName: 'runtimeEvent',
            moduleId: agentWorkspaceContract.id,
            selectedSessionId: sessionId,
          },
        ),
      clearRuntimeEvents: () =>
        window.evaluate(() => {
          ;(
            globalThis as typeof globalThis & { __pictorRuntimeEvents?: unknown[] }
          ).__pictorRuntimeEvents = []
        }),
      runtimeEvents: () =>
        window.evaluate(
          () =>
            (
              globalThis as typeof globalThis & {
                __pictorRuntimeEvents?: Array<Record<string, unknown>>
              }
            ).__pictorRuntimeEvents ?? [],
        ),
    }
    return { harness, server }
  } catch (error) {
    if (electronApp) await closeElectronApp(electronApp)
    await closeServer(server)
    throw error
  }
}

export const test = base.extend<{ piExtension: PiExtensionHarness }>({
  piExtension: async ({ browserName: _browserName }, provide, testInfo) => {
    const { harness, server } = await createHarness(testInfo)
    try {
      await provide(harness)
    } finally {
      try {
        await closeElectronApp(harness.electronApp)
      } finally {
        await closeServer(server)
      }
    }
  },
})

export { expect }
