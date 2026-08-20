import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
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
  const importSource = testInfo.outputPath('import-source.jsonl')
  const importedJsonl = [
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
      type: 'message',
      id: 'imported-original',
      parentId: 'imported-user',
      timestamp: new Date().toISOString(),
      message: { role: 'assistant', content: 'Imported original answer', stopReason: 'stop' },
    }),
    JSON.stringify({
      type: 'message',
      id: 'imported-branch-user',
      parentId: 'imported-user',
      timestamp: new Date().toISOString(),
      message: { role: 'user', content: 'Imported branch task' },
    }),
    JSON.stringify({
      type: 'message',
      id: 'imported-branch-answer',
      parentId: 'imported-branch-user',
      timestamp: new Date().toISOString(),
      message: { role: 'assistant', content: 'Imported branch answer', stopReason: 'stop' },
    }),
    '',
  ].join('\n')
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
  const lifecycleExtension = testInfo.outputPath('fork-lifecycle-extension.ts')
  await writeFile(
    lifecycleExtension,
    `import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
export default function (pi) {
  const record = (ctx, value) => appendFileSync(join(ctx.cwd, 'fork-lifecycle.log'), value + '\\n')
  pi.on('session_before_fork', (event, ctx) => record(ctx, 'before_fork:' + event.entryId + ':' + event.position))
  pi.on('session_before_switch', (_event, ctx) => record(ctx, 'before_switch'))
  pi.on('session_shutdown', (event, ctx) => record(ctx, 'shutdown:' + event.reason))
  pi.on('session_start', (event, ctx) => record(ctx, 'start:' + event.reason))
}
`,
  )
  await store.installPiExtension(lifecycleExtension)

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
    await expect(window.getByText('Native extension completed.').last()).toBeVisible({
      timeout: 30_000,
    })
    await expect(window.getByText('已完成').last()).toBeVisible({ timeout: 30_000 })

    await window.getByRole('button', { name: 'Session Tree' }).click()
    const tree = window.getByRole('complementary', { name: 'Session Tree' })
    const historicalReply = tree
      .getByRole('button', { name: 'Native extension completed.' })
      .first()
    await historicalReply.click()
    await expect(window.getByText(/正在查看历史分支/)).toBeVisible()
    await tree.getByRole('button', { name: 'Fork 为新 Session' }).click()

    await expect(window.getByRole('heading', { name: 'Use the hello tool. (Fork)' })).toBeVisible({
      timeout: 30_000,
    })
    await expect(window.locator('.timeline').getByText('Native extension completed.')).toBeVisible()
    const forkedSnapshot = await window.evaluate(async () => {
      const bridge = (globalThis as typeof globalThis & { pictor: PictorBridge }).pictor
      return bridge.getSnapshot()
    })
    expect(forkedSnapshot).toMatchObject({
      ok: true,
      value: {
        selectedSessionId: expect.any(String),
        sessions: expect.arrayContaining([
          expect.objectContaining({ title: 'Use the hello tool. (Fork)' }),
        ]),
      },
    })
    await expect
      .poll(() => readFile(resolve(projectRoot, 'fork-lifecycle.log'), 'utf8'))
      .toEqual(expect.stringContaining('before_fork:'))
    const lifecycle = await readFile(resolve(projectRoot, 'fork-lifecycle.log'), 'utf8')
    expect(lifecycle).toContain('shutdown:fork')
    expect(lifecycle).toContain('start:fork')

    await window.getByRole('button', { name: 'Session Tree' }).click()
    const forkTree = window.getByRole('complementary', { name: 'Session Tree' })
    const cloneButton = forkTree.getByRole('button', {
      name: 'Clone 当前分支为新 Session',
    })
    await expect(cloneButton).toBeEnabled()
    await cloneButton.click()

    await expect(
      window.getByRole('heading', { name: 'Use the hello tool. (Fork) (Clone)' }),
    ).toBeVisible({ timeout: 30_000 })
    await expect(window.locator('.timeline').getByText('Native extension completed.')).toBeVisible()
    const clonedSnapshot = await window.evaluate(async () => {
      const bridge = (globalThis as typeof globalThis & { pictor: PictorBridge }).pictor
      return bridge.getSnapshot()
    })
    expect(clonedSnapshot).toMatchObject({
      ok: true,
      value: {
        selectedSessionId: expect.any(String),
        sessions: expect.arrayContaining([
          expect.objectContaining({ title: 'Use the hello tool. (Fork) (Clone)' }),
        ]),
      },
    })
    await expect
      .poll(async () => {
        const values = await readFile(resolve(projectRoot, 'fork-lifecycle.log'), 'utf8')
        return values.split('\n').filter((value) => value.startsWith('before_fork:')).length
      })
      .toBe(2)
    const clonedLifecycle = await readFile(resolve(projectRoot, 'fork-lifecycle.log'), 'utf8')
    expect(clonedLifecycle.match(/shutdown:fork/g)).toHaveLength(2)
    expect(clonedLifecycle.match(/start:fork/g)).toHaveLength(2)

    await electronApp.evaluate(({ dialog }, sourcePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [sourcePath] })
    }, importSource)
    await window.getByLabel('pi-extension-project 项目操作').click()
    await window.getByRole('button', { name: '导入 Pi Session' }).click()

    await expect(window.getByRole('heading', { name: 'import-source (Import)' })).toBeVisible({
      timeout: 30_000,
    })
    await expect(window.locator('.timeline').getByText('Imported branch answer')).toBeVisible()
    await window.getByRole('button', { name: 'Session Tree' }).click()
    const importedTree = window.getByRole('complementary', { name: 'Session Tree' })
    await expect(
      importedTree.getByRole('button', { name: 'Imported original answer' }),
    ).toBeVisible()
    await expect(importedTree.getByRole('button', { name: 'Imported branch answer' })).toBeVisible()
    const importedSnapshot = await window.evaluate(async () => {
      const bridge = (globalThis as typeof globalThis & { pictor: PictorBridge }).pictor
      return bridge.getSnapshot()
    })
    expect(importedSnapshot).toMatchObject({
      ok: true,
      value: {
        selectedSessionId: expect.any(String),
        sessions: expect.arrayContaining([
          expect.objectContaining({ title: 'import-source (Import)' }),
        ]),
      },
    })
    expect(await readFile(importSource, 'utf8')).toBe(importedJsonl)
    await expect
      .poll(() => readFile(resolve(projectRoot, 'fork-lifecycle.log'), 'utf8'))
      .toEqual(expect.stringContaining('before_switch'))
    const importedLifecycle = await readFile(resolve(projectRoot, 'fork-lifecycle.log'), 'utf8')
    expect(importedLifecycle).toContain('shutdown:resume')
    expect(importedLifecycle).toContain('start:resume')
  } finally {
    await electronApp.close()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})
