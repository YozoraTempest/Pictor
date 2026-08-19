import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'

import type { PictorBridge } from '../src/shared/desktop-bridge.js'
import {
  bridgeKeys,
  credentialFixtures,
  moduleBridgeKeys,
  readSelectedRunStatus,
} from './support.js'

test('@smoke completes the delegate flow through the GUI and utility-process boundary', async ({
  browserName: _browserName,
}, testInfo) => {
  test.setTimeout(120_000)
  let modelRequestCount = 0
  const server = createServer(async (request, response) => {
    for await (const chunk of request) void chunk
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
  const packagedExecutable = process.env.PICTOR_E2E_EXECUTABLE
  const electronApp = await electron.launch(
    packagedExecutable
      ? {
          executablePath: resolve(packagedExecutable),
          args: [`--user-data-dir=${userDataDirectory}`],
        }
      : {
          args: [resolve('out/main/index.js'), `--user-data-dir=${userDataDirectory}`],
          cwd: resolve('.'),
        },
  )

  try {
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await expect(window).toHaveTitle('Pictor')
    await expect(window.getByRole('heading', { name: '选择一个项目开始' })).toBeVisible()
    const rendererGlobals = await window.evaluate(() => ({
      bodyTextLength: document.body.innerText.length,
      bridgeKeys: Object.keys((globalThis as typeof globalThis & { pictor: object }).pictor),
      moduleBridgeKeys: Object.keys(
        (globalThis as typeof globalThis & { pictorModules: object }).pictorModules,
      ),
      nodeProcessType: typeof Reflect.get(globalThis, 'process'),
    }))
    expect(rendererGlobals.bodyTextLength).toBeGreaterThan(0)
    expect(rendererGlobals.bridgeKeys.sort()).toEqual(bridgeKeys.toSorted())
    expect(rendererGlobals.moduleBridgeKeys.sort()).toEqual(moduleBridgeKeys.toSorted())
    expect(rendererGlobals.nodeProcessType).toBe('undefined')

    await window.getByRole('button', { name: '设置' }).click()
    await expect(window.getByRole('button', { name: 'Chat Completions' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await window.getByLabel('API Base URL').fill(`http://127.0.0.1:${address.port}/v1`)
    await window.getByRole('textbox', { name: '模型', exact: true }).fill('pictor-e2e-model')
    await window.getByLabel('API Key').fill(credentialFixtures.localRuntime)
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
    await expect
      .poll(() => modelRequestCount, {
        message: 'the Agent should continue with a model request after command approval',
        timeout: 30_000,
      })
      .toBeGreaterThanOrEqual(3)
    await expect(window.getByText('已完成').last()).toBeVisible({ timeout: 30_000 })
    await expect(window.getByText('Task completed.')).toBeVisible()
    await expect(window.getByText('Changed files:')).toBeVisible()
    expect(await readSelectedRunStatus(window)).toBe('completed')

    await window.setViewportSize({ width: 900, height: 620 })
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
