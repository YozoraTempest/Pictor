import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'

import type { PictorBridge, RuntimeEvent } from '../src/shared/contracts.js'

const bridgeKeys = [
  'approveCommand',
  'createSession',
  'deleteSession',
  'getAppInfo',
  'getSession',
  'getSettings',
  'getSnapshot',
  'pickProjectDirectory',
  'onRuntimeEvent',
  'registerProject',
  'removeProject',
  'renameSession',
  'rejectCommand',
  'saveSettings',
  'startRun',
  'stopRun',
  'testSettings',
]

test('launches a sandboxed, nonblank desktop shell', async ({
  browserName: _browserName,
}, testInfo) => {
  const electronApp = await electron.launch({
    args: [resolve('out/main/index.js')],
    cwd: resolve('.'),
  })

  try {
    const window = await electronApp.firstWindow()
    const rendererErrors: string[] = []
    window.on('console', (message) => {
      if (message.type() === 'error') {
        rendererErrors.push(message.text())
      }
    })
    window.on('pageerror', (error) => rendererErrors.push(error.message))

    await window.waitForLoadState('domcontentloaded')
    await expect(window).toHaveTitle('Pictor')
    const heading = window.getByRole('heading', { name: '选择一个项目开始' })
    try {
      await expect(heading).toBeVisible()
    } catch (error) {
      const diagnostics = await window.evaluate(() => ({
        bodyText: document.body.innerText,
        url: location.href,
      }))
      throw new Error(
        `Renderer did not mount: ${JSON.stringify({ ...diagnostics, rendererErrors })}`,
        { cause: error },
      )
    }

    const rendererGlobals = await window.evaluate(() => ({
      bridgeKeys: Object.keys(
        (globalThis as typeof globalThis & { pictor: { getAppInfo: unknown } }).pictor,
      ),
      nodeProcessType: typeof Reflect.get(globalThis, 'process'),
    }))

    expect(rendererGlobals.bridgeKeys.sort()).toEqual(bridgeKeys.toSorted())
    expect(rendererGlobals.nodeProcessType).toBe('undefined')

    await window.screenshot({ path: testInfo.outputPath('pictor-shell.png') })
  } finally {
    await electronApp.close()
  }
})

test('encrypts model credentials and restores non-secret settings', async ({
  browserName: _browserName,
}, testInfo) => {
  const userDataDirectory = testInfo.outputPath('user-data')
  const launch = () =>
    electron.launch({
      args: [resolve('out/main/index.js'), `--user-data-dir=${userDataDirectory}`],
      cwd: resolve('.'),
    })

  const firstApp = await launch()
  const firstWindow = await firstApp.firstWindow()
  await firstWindow.waitForLoadState('domcontentloaded')
  const saved = await firstWindow.evaluate(() =>
    (globalThis as typeof globalThis & { pictor: PictorBridge }).pictor.saveSettings({
      baseUrl: 'https://api.example.test/v1',
      modelId: 'model-e2e',
      temperature: 0.3,
      maxOutputTokens: 4096,
      apiKey: { action: 'replace', value: 'pictor-e2e-secret' },
    }),
  )
  expect(saved).toEqual({
    ok: true,
    value: {
      baseUrl: 'https://api.example.test/v1',
      modelId: 'model-e2e',
      temperature: 0.3,
      maxOutputTokens: 4096,
      hasApiKey: true,
    },
  })
  await firstApp.close()

  const dataDirectory = join(userDataDirectory, 'data-v1')
  const persistedText = await Promise.all([
    readFile(join(dataDirectory, 'state.json'), 'utf8'),
    readFile(join(dataDirectory, 'secrets.json'), 'utf8'),
  ])
  expect(persistedText.join('\n')).not.toContain('pictor-e2e-secret')

  const restoredApp = await launch()
  try {
    const restoredWindow = await restoredApp.firstWindow()
    await restoredWindow.waitForLoadState('domcontentloaded')
    const snapshot = await restoredWindow.evaluate(() =>
      (globalThis as typeof globalThis & { pictor: PictorBridge }).pictor.getSnapshot(),
    )
    expect(snapshot).toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({
          settings: {
            baseUrl: 'https://api.example.test/v1',
            modelId: 'model-e2e',
            temperature: 0.3,
            maxOutputTokens: 4096,
            hasApiKey: true,
          },
        }),
      }),
    )
  } finally {
    await restoredApp.close()
  }
})

test('runs a streamed Pi task through the utility-process boundary', async ({
  browserName: _browserName,
}, testInfo) => {
  let modelRequestCount = 0
  const server = createServer((_request, response) => {
    modelRequestCount += 1
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    if (modelRequestCount === 1) {
      response.write(
        `data: ${JSON.stringify({
          id: 'chatcmpl-e2e-tool',
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
                    id: 'call-command-e2e',
                    type: 'function',
                    function: {
                      name: 'pictor_command',
                      arguments: JSON.stringify({
                        command: 'printf approved > command-approved.txt',
                        cwd: '.',
                        purpose: 'Verify command approval',
                      }),
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
          id: 'chatcmpl-e2e-tool',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'pictor-e2e-model',
          choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
        })}\n\n`,
      )
      response.end('data: [DONE]\n\n')
      return
    }
    response.write(
      `data: ${JSON.stringify({
        id: 'chatcmpl-e2e',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'pictor-e2e-model',
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: 'Utility runtime works' },
            finish_reason: null,
          },
        ],
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
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('E2E model server failed to bind')

  const projectRoot = testInfo.outputPath('runtime-project')
  const userDataDirectory = testInfo.outputPath('runtime-user-data')
  await mkdir(projectRoot, { recursive: true })
  const electronApp = await electron.launch({
    args: [resolve('out/main/index.js'), `--user-data-dir=${userDataDirectory}`],
    cwd: resolve('.'),
  })

  try {
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.evaluate(() => {
      const global = globalThis as typeof globalThis & {
        pictor: PictorBridge
        runtimeEvents: RuntimeEvent[]
        unsubscribeRuntime: () => void
      }
      global.runtimeEvents = []
      global.unsubscribeRuntime = global.pictor.onRuntimeEvent((event) =>
        global.runtimeEvents.push(event),
      )
    })
    const setup = await window.evaluate(
      async ({ baseUrl, projectRoot }) => {
        const bridge = (globalThis as typeof globalThis & { pictor: PictorBridge }).pictor
        const settings = await bridge.saveSettings({
          baseUrl,
          modelId: 'pictor-e2e-model',
          temperature: null,
          maxOutputTokens: 64,
          apiKey: { action: 'replace', value: 'local-e2e-key' },
        })
        const project = await bridge.registerProject({ rootPath: projectRoot, trusted: true })
        if (!project.ok) return { settings, project, session: null, run: null }
        const session = await bridge.createSession({ projectId: project.value.id })
        if (!session.ok) return { settings, project, session, run: null }
        const run = await bridge.startRun({ sessionId: session.value.id, prompt: 'Say hello.' })
        return { settings, project, session, run }
      },
      { baseUrl: `http://127.0.0.1:${address.port}/v1`, projectRoot },
    )
    expect(setup.settings.ok).toBe(true)
    expect(setup.project.ok).toBe(true)
    expect(setup.session?.ok).toBe(true)
    expect(setup.run?.ok).toBe(true)

    await window.waitForFunction(
      () =>
        (globalThis as typeof globalThis & { runtimeEvents: RuntimeEvent[] }).runtimeEvents.some(
          (event) => event.type === 'approval.requested',
        ),
      undefined,
      { timeout: 20_000 },
    )
    await expect(readFile(join(projectRoot, 'command-approved.txt'), 'utf8')).rejects.toThrow()
    const approval = await window.evaluate(async () => {
      const global = globalThis as typeof globalThis & {
        pictor: PictorBridge
        runtimeEvents: RuntimeEvent[]
      }
      const event = global.runtimeEvents.find(
        (candidate) => candidate.type === 'approval.requested',
      )
      if (!event || event.type !== 'approval.requested') return null
      return global.pictor.approveCommand({ runId: event.runId, callId: event.callId })
    })
    expect(approval).toEqual({ ok: true, value: null })

    await window.waitForFunction(
      () =>
        (globalThis as typeof globalThis & { runtimeEvents: RuntimeEvent[] }).runtimeEvents.some(
          (event) => event.type === 'run.stateChanged' && event.status === 'completed',
        ),
      undefined,
      { timeout: 20_000 },
    )
    const evidence = await window.evaluate(async () => {
      const global = globalThis as typeof globalThis & {
        pictor: PictorBridge
        runtimeEvents: RuntimeEvent[]
        unsubscribeRuntime: () => void
      }
      global.unsubscribeRuntime()
      const completed = global.runtimeEvents.find((event) => event.type === 'message.completed')
      const snapshot = await global.pictor.getSnapshot()
      if (!snapshot.ok || !snapshot.value.sessions[0]) return { completed, session: null }
      const session = await global.pictor.getSession({ sessionId: snapshot.value.sessions[0].id })
      return { completed, session }
    })

    expect(evidence.completed).toEqual(
      expect.objectContaining({ type: 'message.completed', content: 'Utility runtime works' }),
    )
    expect(await readFile(join(projectRoot, 'command-approved.txt'), 'utf8')).toBe('approved')
    expect(evidence.session).toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'assistant', content: 'Utility runtime works' }),
          ]),
          runs: expect.arrayContaining([
            expect.objectContaining({
              status: 'completed',
              toolEvents: expect.arrayContaining([
                expect.objectContaining({
                  kind: 'command',
                  status: 'completed',
                  command: expect.objectContaining({ approval: 'allowed' }),
                  output: expect.stringContaining('exit: 0'),
                }),
              ]),
            }),
          ]),
        }),
      }),
    )
  } finally {
    await electronApp.close()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})
