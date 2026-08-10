import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'

import type { PictorBridge } from '../src/shared/contracts.js'

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
  'relinkProject',
  'removeProject',
  'renameSession',
  'rejectCommand',
  'saveSettings',
  'selectContext',
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

test('completes the delegate flow through the GUI and utility-process boundary', async ({
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

    await window.getByRole('button', { name: '模型设置' }).click()
    await window.getByLabel('API Base URL').fill(`http://127.0.0.1:${address.port}/v1`)
    await window.getByRole('textbox', { name: '模型', exact: true }).fill('pictor-e2e-model')
    await window.getByLabel('API Key').fill('local-e2e-key')
    await window.getByLabel('最大输出 Token').fill('64')
    await window.getByRole('button', { name: '保存设置' }).click()
    await expect(window.getByRole('dialog')).toBeHidden()

    const project = await window.evaluate(
      async (rootPath) =>
        (globalThis as typeof globalThis & { pictor: PictorBridge }).pictor.registerProject({
          rootPath,
          trusted: true,
        }),
      projectRoot,
    )
    expect(project.ok).toBe(true)
    await window.reload()
    await window.waitForLoadState('domcontentloaded')

    await window.getByRole('button', { name: '新建 Session' }).first().click()
    await expect(window.getByRole('heading', { name: '新建会话' })).toBeVisible()
    await window.getByRole('textbox', { name: '任务描述' }).fill('Say hello.')
    await window.getByRole('button', { name: '发送任务' }).click()

    await expect(window.getByText('printf approved > command-approved.txt')).toBeVisible({
      timeout: 20_000,
    })
    await expect(readFile(join(projectRoot, 'command-approved.txt'), 'utf8')).rejects.toThrow()
    await window.screenshot({ path: testInfo.outputPath('delegate-approval.png') })
    await window.getByRole('button', { name: '允许一次' }).click()
    await expect(window.getByText('Utility runtime works')).toBeVisible({ timeout: 20_000 })
    await expect(window.getByText('已完成').last()).toBeVisible()

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(900, 620)
    })
    await expect.poll(() => window.evaluate(() => globalThis.innerWidth)).toBe(900)
    const layout = await window.evaluate(() => ({
      bodyWidth: document.body.scrollWidth,
      viewportWidth: globalThis.innerWidth,
      composer: document.querySelector('.composer')?.getBoundingClientRect().toJSON(),
      sidebar: document.querySelector('.sidebar')?.getBoundingClientRect().toJSON(),
    }))
    expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewportWidth)
    expect(layout.composer?.width).toBeGreaterThan(300)
    expect(layout.sidebar?.width).toBeGreaterThanOrEqual(230)
    await window.screenshot({ path: testInfo.outputPath('delegate-constrained.png') })

    const evidence = await window.evaluate(async () => {
      const bridge = (globalThis as typeof globalThis & { pictor: PictorBridge }).pictor
      const snapshot = await bridge.getSnapshot()
      if (!snapshot.ok || !snapshot.value.sessions[0]) return null
      return bridge.getSession({ sessionId: snapshot.value.sessions[0].id })
    })

    expect(await readFile(join(projectRoot, 'command-approved.txt'), 'utf8')).toBe('approved')
    expect(evidence).toEqual(
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
