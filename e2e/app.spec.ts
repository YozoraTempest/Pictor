import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { createServer, type ServerResponse } from 'node:http'
import { join, resolve } from 'node:path'

import type { PictorBridge } from '../src/shared/contracts.js'

process.env.PICTOR_E2E_HEADLESS = '1'

const bridgeKeys = [
  'approveCommand',
  'createSession',
  'deleteSession',
  'getAppInfo',
  'getSession',
  'getSettings',
  'getSnapshot',
  'listModels',
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

function writeResponsesEvents(response: ServerResponse, events: unknown[]): void {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    Connection: 'keep-alive',
    'Cache-Control': 'no-cache',
  })
  for (const event of events) response.write(`data: ${JSON.stringify(event)}\n\n`)
  response.end('data: [DONE]\n\n')
}

function writeResponsesToolCall(
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

function writeResponsesText(response: ServerResponse, responseId: string, text: string): void {
  const itemId = `msg_${responseId}`
  const item = {
    id: itemId,
    type: 'message',
    status: 'completed',
    role: 'assistant',
    content: [{ type: 'output_text', text, annotations: [], logprobs: [] }],
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
      delta: text,
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

function writeChatText(response: ServerResponse, text: string): void {
  response.writeHead(200, { 'Content-Type': 'text/event-stream' })
  response.write(
    `data: ${JSON.stringify({
      id: 'chatcmpl-runtime-recovery',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'pictor-e2e-model',
      choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }],
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
      apiProtocol: 'responses',
      baseUrl: 'https://api.example.test/v1',
      modelId: 'model-e2e',
      reasoningEffort: 'xhigh',
      temperature: 0.3,
      maxOutputTokens: 4096,
      apiKey: { action: 'replace', value: 'pictor-e2e-secret' },
    }),
  )
  expect(saved).toEqual({
    ok: true,
    value: {
      apiProtocol: 'responses',
      baseUrl: 'https://api.example.test/v1',
      modelId: 'model-e2e',
      reasoningEffort: 'xhigh',
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
            apiProtocol: 'responses',
            baseUrl: 'https://api.example.test/v1',
            modelId: 'model-e2e',
            reasoningEffort: 'xhigh',
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
          id: 'chatcmpl-e2e-write',
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
                    id: 'call-write-e2e',
                    type: 'function',
                    function: {
                      name: 'pictor_write',
                      arguments: JSON.stringify({
                        path: 'agent-created.txt',
                        content: 'created by Pictor',
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
          id: 'chatcmpl-e2e-write',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'pictor-e2e-model',
          choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
        })}\n\n`,
      )
      response.end('data: [DONE]\n\n')
      return
    }
    if (modelRequestCount === 2) {
      response.write(
        `data: ${JSON.stringify({
          id: 'chatcmpl-e2e-command',
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
          id: 'chatcmpl-e2e-command',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'pictor-e2e-model',
          choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
        })}\n\n`,
      )
      response.end('data: [DONE]\n\n')
      return
    }
    if (modelRequestCount === 4) {
      response.write(
        `data: ${JSON.stringify({
          id: 'chatcmpl-e2e-stoppable',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'pictor-e2e-model',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: 'Working until stopped' },
              finish_reason: null,
            },
          ],
        })}\n\n`,
      )
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
            delta: {
              role: 'assistant',
              content:
                'Task completed.\n\nChanged files:\n- `agent-created.txt`\n- `command-approved.txt`\n\nVerification:\n- Approved command exited with code 0.\n\nRemaining work: none.',
            },
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
    await expect(window.getByRole('button', { name: 'Chat Completions' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await window.getByLabel('API Base URL').fill(`http://127.0.0.1:${address.port}/v1`)
    await window.getByRole('textbox', { name: '模型', exact: true }).fill('pictor-e2e-model')
    await window.getByLabel('API Key').fill('local-e2e-key')
    await window.getByLabel('最大输出 Token').fill('64')
    await window.getByRole('button', { name: 'Responses' }).click()
    await window.screenshot({ path: testInfo.outputPath('model-settings.png') })
    await window.getByRole('button', { name: 'Chat Completions' }).click()
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
    await expect(window.getByText('agent-created.txt').first()).toBeVisible()
    expect(await readFile(join(projectRoot, 'agent-created.txt'), 'utf8')).toBe('created by Pictor')
    await expect(readFile(join(projectRoot, 'command-approved.txt'), 'utf8')).rejects.toThrow()
    await window.screenshot({ path: testInfo.outputPath('delegate-approval.png') })
    await window.getByRole('button', { name: '允许一次' }).click()
    await expect(window.getByText('Task completed.')).toBeVisible({ timeout: 20_000 })
    await expect(window.getByText('Changed files:')).toBeVisible()
    await expect(window.getByText('已完成').last()).toBeVisible()

    await electronApp.evaluate(async ({ BrowserWindow }) => {
      const target = BrowserWindow.getAllWindows().find(
        (candidate) => candidate.getTitle() === 'Pictor',
      )
      if (!target) throw new Error('Pictor window is unavailable')
      target.restore()
      target.setResizable(true)
      target.setContentSize(900, 620)
      await new Promise((resolveResize) => setTimeout(resolveResize, 250))
      target.setContentSize(900, 620)
    })
    await expect
      .poll(() => window.evaluate(() => globalThis.innerWidth), { timeout: 10_000 })
      .toBe(900)
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

    await window.getByRole('textbox', { name: '任务描述' }).fill('Keep working until stopped.')
    await window.getByRole('button', { name: '发送任务' }).click()
    await expect(window.getByText('Working until stopped')).toBeVisible({ timeout: 20_000 })
    await window.getByRole('button', { name: '停止', exact: true }).click()
    await expect(window.getByText('已停止').last()).toBeVisible({ timeout: 20_000 })

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
            expect.objectContaining({
              role: 'assistant',
              content: expect.stringContaining('Remaining work: none.'),
            }),
          ]),
          runs: expect.arrayContaining([
            expect.objectContaining({
              status: 'completed',
              toolEvents: expect.arrayContaining([
                expect.objectContaining({
                  kind: 'write',
                  path: 'agent-created.txt',
                  status: 'completed',
                }),
                expect.objectContaining({
                  kind: 'command',
                  status: 'completed',
                  command: expect.objectContaining({ approval: 'allowed' }),
                  output: expect.stringContaining('exit: 0'),
                }),
              ]),
            }),
            expect.objectContaining({ status: 'stopped' }),
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

test('shows a readable runtime failure and keeps the session sendable', async ({
  browserName: _browserName,
}, testInfo) => {
  let requestCount = 0
  const server = createServer((_request, response) => {
    requestCount += 1
    if (requestCount === 1) {
      response.writeHead(401, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'Invalid API key' } }))
      return
    }
    writeChatText(response, 'Recovered after runtime failure.')
  })
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('E2E model server failed to bind')

  const projectRoot = testInfo.outputPath('runtime-error-project')
  const userDataDirectory = testInfo.outputPath('runtime-error-user-data')
  await mkdir(projectRoot, { recursive: true })
  const electronApp = await electron.launch({
    args: [resolve('out/main/index.js'), `--user-data-dir=${userDataDirectory}`],
    cwd: resolve('.'),
  })

  try {
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    expect(
      await electronApp.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every((candidate) => !candidate.isVisible()),
      ),
    ).toBe(true)

    const setup = await window.evaluate(
      async ({ baseUrl, rootPath }) => {
        const bridge = (globalThis as typeof globalThis & { pictor: PictorBridge }).pictor
        const settings = await bridge.saveSettings({
          apiProtocol: 'chat-completions',
          baseUrl,
          modelId: 'pictor-e2e-model',
          reasoningEffort: null,
          temperature: null,
          maxOutputTokens: 64,
          apiKey: { action: 'replace', value: 'recovery-e2e-key' },
        })
        const project = await bridge.registerProject({ rootPath, trusted: true })
        if (!project.ok) return { settings, project, session: null }
        const session = await bridge.createSession({ projectId: project.value.id })
        if (session.ok) {
          await bridge.selectContext({ projectId: project.value.id, sessionId: session.value.id })
        }
        return { settings, project, session }
      },
      { baseUrl: `http://127.0.0.1:${address.port}/v1`, rootPath: projectRoot },
    )
    expect(setup.settings.ok).toBe(true)
    expect(setup.project.ok).toBe(true)
    expect(setup.session?.ok).toBe(true)

    await window.reload()
    await window.waitForLoadState('domcontentloaded')
    const composer = window.getByRole('textbox', { name: '任务描述' })
    const send = window.getByRole('button', { name: '发送任务' })
    await composer.fill('Trigger authentication failure.')
    await send.click()

    await expect(window.getByText(/模型认证失败：请检查 API Key 和端点权限后重试。/)).toBeVisible({
      timeout: 20_000,
    })
    await expect(window.getByText('失败').last()).toBeVisible()

    await composer.fill('Continue in the same session.')
    await expect(send).toBeEnabled()
    await send.click()
    await expect(window.getByText('Recovered after runtime failure.')).toBeVisible({
      timeout: 20_000,
    })
    await expect(window.getByText('已完成').last()).toBeVisible()

    const session = await window.evaluate(async () => {
      const bridge = (globalThis as typeof globalThis & { pictor: PictorBridge }).pictor
      const snapshot = await bridge.getSnapshot()
      if (!snapshot.ok || !snapshot.value.selectedSessionId) return null
      return bridge.getSession({ sessionId: snapshot.value.selectedSessionId })
    })
    expect(session).toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({
          runs: [
            expect.objectContaining({
              status: 'failed',
              error: expect.stringContaining('模型认证失败'),
            }),
            expect.objectContaining({ status: 'completed', error: null }),
          ],
        }),
      }),
    )
  } finally {
    await electronApp.close()
    await new Promise<void>((resolveClose, reject) =>
      server.close((error) => (error ? reject(error) : resolveClose())),
    )
  }
})

test('completes model discovery and the delegate tool flow with Responses', async ({
  browserName: _browserName,
}, testInfo) => {
  let runtimeRequestCount = 0
  let probeRequest: Record<string, unknown> | null = null
  let firstRuntimeRequest: Record<string, unknown> | null = null
  const server = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/v1/models') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ data: [{ id: 'gpt-5.6-sol' }, { id: 'gpt-4.1' }] }))
      return
    }

    let body = ''
    for await (const chunk of request) body += chunk.toString()
    const parsed = JSON.parse(body) as Record<string, unknown>
    const toolChoice = parsed.tool_choice as { name?: string } | undefined
    if (toolChoice?.name === 'pictor_connection_test') {
      probeRequest = parsed
      writeResponsesToolCall(response, 'resp_probe', 'call_probe', 'pictor_connection_test', {})
      return
    }

    runtimeRequestCount += 1
    firstRuntimeRequest ??= parsed
    if (runtimeRequestCount === 1) {
      writeResponsesToolCall(response, 'resp_write', 'call_write', 'pictor_write', {
        path: 'responses-created.txt',
        content: 'created through Responses',
      })
      return
    }
    if (runtimeRequestCount === 2) {
      writeResponsesToolCall(response, 'resp_command', 'call_command', 'pictor_command', {
        command: 'printf responses-approved > responses-command.txt',
        cwd: '.',
        purpose: 'Verify Responses command approval',
      })
      return
    }
    writeResponsesText(
      response,
      'resp_final',
      'Responses task completed.\n\nChanged files:\n- `responses-created.txt`\n- `responses-command.txt`\n\nVerification:\n- Approved command exited with code 0.\n\nRemaining work: none.',
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('E2E model server failed to bind')

  const projectRoot = testInfo.outputPath('responses-runtime-project')
  const userDataDirectory = testInfo.outputPath('responses-runtime-user-data')
  await mkdir(projectRoot, { recursive: true })
  const electronApp = await electron.launch({
    args: [resolve('out/main/index.js'), `--user-data-dir=${userDataDirectory}`],
    cwd: resolve('.'),
  })

  try {
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    await window.getByRole('button', { name: '模型设置' }).click()
    await window.getByRole('button', { name: 'Responses' }).click()
    await window.getByLabel('API Base URL').fill(`http://127.0.0.1:${address.port}/v1`)
    await window.getByLabel('API Key').fill('responses-e2e-key')
    await window.getByRole('button', { name: '获取模型' }).click()
    await expect(window.getByText('已获取 2 个可用模型')).toBeVisible()
    await window.getByRole('combobox', { name: '模型', exact: true }).selectOption('gpt-5.6-sol')
    await window.getByRole('combobox', { name: '模型强度' }).selectOption('xhigh')
    await window.getByRole('button', { name: '测试连接' }).click()
    await expect(window.getByText('连接成功，已验证 Responses 流式工具调用')).toBeVisible()
    await window.screenshot({ path: testInfo.outputPath('responses-settings-verified.png') })
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
    await window.getByRole('textbox', { name: '任务描述' }).fill('Complete a Responses task.')
    await window.getByRole('button', { name: '发送任务' }).click()

    await expect(window.getByText('responses-created.txt').first()).toBeVisible({
      timeout: 20_000,
    })
    await expect(window.getByText('printf responses-approved > responses-command.txt')).toBeVisible(
      { timeout: 20_000 },
    )
    expect(await readFile(join(projectRoot, 'responses-created.txt'), 'utf8')).toBe(
      'created through Responses',
    )
    await window.getByRole('button', { name: '允许一次' }).click()
    await expect(window.getByText('Responses task completed.')).toBeVisible({ timeout: 20_000 })
    await expect(window.getByText('已完成').last()).toBeVisible()

    expect(await readFile(join(projectRoot, 'responses-command.txt'), 'utf8')).toBe(
      'responses-approved',
    )
    expect(probeRequest).toEqual(
      expect.objectContaining({ reasoning: expect.objectContaining({ effort: 'xhigh' }) }),
    )
    expect(firstRuntimeRequest).toEqual(
      expect.objectContaining({ reasoning: expect.objectContaining({ effort: 'xhigh' }) }),
    )
  } finally {
    await electronApp.close()
    await new Promise<void>((resolveClose, reject) =>
      server.close((error) => (error ? reject(error) : resolveClose())),
    )
  }
})

test('confirms active-run exit and restores the run as interrupted', async ({
  browserName: _browserName,
}, testInfo) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.write(
      `data: ${JSON.stringify({
        id: 'chatcmpl-close-confirmation',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'pictor-e2e-model',
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: 'Still running' },
            finish_reason: null,
          },
        ],
      })}\n\n`,
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('E2E model server failed to bind')

  const projectRoot = testInfo.outputPath('interrupted-project')
  const userDataDirectory = testInfo.outputPath('interrupted-user-data')
  await mkdir(projectRoot, { recursive: true })
  const launch = () =>
    electron.launch({
      args: [resolve('out/main/index.js'), `--user-data-dir=${userDataDirectory}`],
      cwd: resolve('.'),
    })

  const firstApp = await launch()
  let restoredApp: Awaited<ReturnType<typeof launch>> | null = null
  try {
    const firstWindow = await firstApp.firstWindow()
    await firstWindow.waitForLoadState('domcontentloaded')
    const setup = await firstWindow.evaluate(
      async ({ baseUrl, projectRoot }) => {
        const bridge = (globalThis as typeof globalThis & { pictor: PictorBridge }).pictor
        const settings = await bridge.saveSettings({
          apiProtocol: 'chat-completions',
          baseUrl,
          modelId: 'pictor-e2e-model',
          reasoningEffort: null,
          temperature: null,
          maxOutputTokens: 64,
          apiKey: { action: 'replace', value: 'interrupted-e2e-key' },
        })
        const project = await bridge.registerProject({ rootPath: projectRoot, trusted: true })
        if (!project.ok) return { settings, project, session: null, run: null }
        const session = await bridge.createSession({ projectId: project.value.id })
        if (!session.ok) return { settings, project, session, run: null }
        const run = await bridge.startRun({ sessionId: session.value.id, prompt: 'Keep running.' })
        return { settings, project, session, run }
      },
      { baseUrl: `http://127.0.0.1:${address.port}/v1`, projectRoot },
    )
    expect(setup.run?.ok).toBe(true)
    if (!setup.session?.ok) throw new Error('Interrupted-run E2E session setup failed')
    const interruptedSessionId = setup.session.value.id
    await expect
      .poll(
        () =>
          firstWindow.evaluate(async (sessionId) => {
            const bridge = (globalThis as typeof globalThis & { pictor: PictorBridge }).pictor
            const response = await bridge.getSession({ sessionId })
            return response.ok ? response.value.runs.at(-1)?.status : null
          }, interruptedSessionId),
        { timeout: 20_000 },
      )
      .toBe('running')

    const keptOpen = await firstApp.evaluate(({ BrowserWindow, dialog }) => {
      dialog.showMessageBoxSync = () => 0
      const window = BrowserWindow.getAllWindows()[0]
      window?.close()
      return Boolean(window && !window.isDestroyed())
    })
    expect(keptOpen).toBe(true)

    const firstProcess = firstApp.process()
    const exited = new Promise<void>((resolveExit) =>
      firstProcess.once('exit', () => resolveExit()),
    )
    await firstApp.evaluate(({ BrowserWindow, dialog }) => {
      dialog.showMessageBoxSync = () => 1
      BrowserWindow.getAllWindows()[0]?.close()
    })
    await exited

    restoredApp = await launch()
    const restoredWindow = await restoredApp.firstWindow()
    await restoredWindow.waitForLoadState('domcontentloaded')
    const restored = await restoredWindow.evaluate(async () => {
      const bridge = (globalThis as typeof globalThis & { pictor: PictorBridge }).pictor
      const snapshot = await bridge.getSnapshot()
      if (!snapshot.ok || !snapshot.value.selectedSessionId) return null
      return bridge.getSession({ sessionId: snapshot.value.selectedSessionId })
    })
    expect(restored).toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({
          runs: expect.arrayContaining([
            expect.objectContaining({
              status: 'interrupted',
              error: '应用在运行完成前关闭，任务未自动重放',
            }),
          ]),
        }),
      }),
    )
  } finally {
    await restoredApp?.close().catch(() => undefined)
    await firstApp.close().catch(() => undefined)
    server.closeAllConnections()
    await new Promise<void>((resolveClose, reject) =>
      server.close((error) => (error ? reject(error) : resolveClose())),
    )
  }
})
