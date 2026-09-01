import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'

import {
  credentialFixtures,
  invokeAgentWorkspace,
  readSelectedRunStatus,
  writeResponsesText,
  writeResponsesToolCall,
} from './support.js'
import { closeElectronApp } from './electron-cleanup.js'

test('completes model discovery and the delegate tool flow with Responses', async ({
  browserName: _browserName,
}, testInfo) => {
  test.setTimeout(120_000)
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
      writeResponsesToolCall(response, 'resp_write', 'call_write', 'write', {
        path: 'responses-created.txt',
        content: 'created through Responses',
      })
      return
    }
    if (runtimeRequestCount === 2) {
      writeResponsesToolCall(response, 'resp_command', 'call_command', 'bash', {
        command: 'printf responses-approved > responses-command.txt',
      })
      return
    }
    writeResponsesText(
      response,
      'resp_final',
      'Responses task completed.\n\nChanged files:\n- `responses-created.txt`\n- `responses-command.txt`\n\nVerification:\n- Native Pi tools completed.\n\nRemaining work: none.',
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
  let businessFailed = false

  try {
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    await window.getByRole('button', { name: '设置' }).click()
    await window.getByRole('button', { name: 'Responses' }).click()
    await window.getByLabel('API Base URL').fill(`http://127.0.0.1:${address.port}/v1`)
    await window.getByLabel('API Key').fill(credentialFixtures.responsesRuntime)
    await window.getByRole('button', { name: '获取模型' }).click()
    await expect(window.getByText('已获取 2 个可用模型')).toBeVisible()
    await window.getByRole('combobox', { name: '模型', exact: true }).selectOption('gpt-5.6-sol')
    await window.getByRole('combobox', { name: '模型强度' }).selectOption('xhigh')
    await window.getByRole('button', { name: '测试连接' }).click()
    await expect(window.getByText('连接成功，已验证 Responses 流式工具调用')).toBeVisible()
    await window.screenshot({ path: testInfo.outputPath('responses-settings-verified.png') })
    await window.getByRole('button', { name: '保存设置' }).click()
    await expect(window.getByRole('dialog')).toBeHidden()

    const project = await invokeAgentWorkspace(window, 'registerProject', {
      rootPath: projectRoot,
      trusted: true,
    })
    expect(project.ok).toBe(true)
    await window.reload()
    await window.waitForLoadState('domcontentloaded')
    await window.getByRole('button', { name: '新建 Session' }).first().click()
    await window.getByRole('textbox', { name: '任务描述' }).fill('Complete a Responses task.')
    await window.getByRole('button', { name: '发送任务' }).click()

    await expect(window.getByText('responses-created.txt').first()).toBeVisible({
      timeout: 40_000,
    })
    expect(await readFile(join(projectRoot, 'responses-created.txt'), 'utf8')).toBe(
      'created through Responses',
    )
    await expect
      .poll(() => readFile(join(projectRoot, 'responses-command.txt'), 'utf8'))
      .toBe('responses-approved')
    await expect(window.getByText('Responses task completed.')).toBeVisible({ timeout: 20_000 })
    await expect(window.getByText('已完成').last()).toBeVisible({ timeout: 30_000 })
    expect(await readSelectedRunStatus(window)).toBe('completed')

    expect(await readFile(join(projectRoot, 'responses-command.txt'), 'utf8')).toBe(
      'responses-approved',
    )
    expect(probeRequest).toEqual(
      expect.objectContaining({ reasoning: expect.objectContaining({ effort: 'xhigh' }) }),
    )
    expect(firstRuntimeRequest).toEqual(
      expect.objectContaining({ reasoning: expect.objectContaining({ effort: 'xhigh' }) }),
    )
  } catch (error) {
    businessFailed = true
    return Promise.reject(error)
  } finally {
    try {
      await closeElectronApp(electronApp, { mode: businessFailed ? 'suppress' : 'strict' })
    } finally {
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      )
    }
  }
})
