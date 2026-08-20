import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'

import type { PictorBridge } from '../src/shared/desktop-bridge.js'
import { defaultPluginProfile } from '../src/main/plugins/default-profile.js'
import { PluginStore } from '../src/main/plugins/plugin-store.js'
import { credentialFixtures } from './support.js'

test('loads an unmodified native Pi Extension from the user Store', async ({
  browserName: _browserName,
}, testInfo) => {
  let requestCount = 0
  const server = createServer(async (request, response) => {
    for await (const chunk of request) void chunk
    requestCount += 1
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    if (requestCount === 1 || requestCount === 3) {
      const toolName = requestCount === 1 ? 'hello' : 'ask_gui'
      const callId = requestCount === 1 ? 'call-native-hello' : 'call-extension-ui'
      const toolArguments = requestCount === 1 ? { name: 'Pictor' } : {}
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
                    function: { name: toolName, arguments: JSON.stringify(toolArguments) },
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
    } else {
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
    response.end('data: [DONE]\n\n')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('E2E model server failed to bind')

  const userDataDirectory = testInfo.outputPath('pi-extension-user-data')
  const projectRoot = testInfo.outputPath('pi-extension-project')
  await mkdir(projectRoot, { recursive: true })
  const store = new PluginStore({
    userDataDirectory,
    bundledPluginsDirectory: resolve('.pictor/bundled-plugins'),
    profile: defaultPluginProfile,
  })
  await store.initialize()
  await store.installPiExtension(
    resolve('node_modules/@earendil-works/pi-coding-agent/examples/extensions/hello.ts'),
  )
  const guiExtension = testInfo.outputPath('gui-extension.ts')
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
  await store.installPiExtension(guiExtension)

  const electronApp = await electron.launch({
    args: [resolve('out/main/index.js'), `--user-data-dir=${userDataDirectory}`],
    cwd: resolve('.'),
  })
  try {
    const window = await electronApp.firstWindow()
    await expect(window.getByRole('heading', { name: '选择一个项目开始' })).toBeVisible()
    await window.getByRole('button', { name: '设置' }).click()
    await window.getByLabel('API Base URL').fill(`http://127.0.0.1:${address.port}/v1`)
    await window.getByRole('textbox', { name: '模型', exact: true }).fill('pictor-e2e-model')
    await window.getByLabel('API Key').fill(credentialFixtures.localRuntime)
    await window.getByRole('button', { name: '保存设置' }).click()

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
    await window.getByRole('button', { name: '新建 Session' }).first().click()
    await window.getByRole('textbox', { name: '任务描述' }).fill('Use the hello tool.')
    await window.getByRole('button', { name: '发送任务' }).click()

    await expect(window.getByText('Extension Tool')).toBeVisible({ timeout: 30_000 })
    await window.getByText('查看输出').click()
    await expect(window.getByText('Hello, Pictor!')).toBeVisible({ timeout: 30_000 })
    await expect(window.getByText('Native extension completed.')).toBeVisible({ timeout: 30_000 })
    await expect(window.getByText('已完成').last()).toBeVisible({ timeout: 30_000 })

    await window.getByRole('textbox', { name: '任务描述' }).fill('Ask through the GUI.')
    await window.getByRole('button', { name: '发送任务' }).click()
    await expect(window.getByRole('heading', { name: 'Enter a value' })).toBeVisible()
    await window.getByLabel('输入').fill('GUI response')
    await window.getByRole('button', { name: '确认' }).click()
    const guiTool = window.locator('.tool-activity').last()
    await guiTool.getByText('查看输出').click()
    await expect(guiTool.getByText('GUI response')).toBeVisible()
  } finally {
    await electronApp.close()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})
