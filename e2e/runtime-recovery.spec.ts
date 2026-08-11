import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'

import type { PictorBridge } from '../src/shared/contracts.js'
import { credentialFixtures, readSelectedRunStatus, writeChatText } from './support.js'

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
      async ({ apiKey, baseUrl, rootPath }) => {
        const bridge = (globalThis as typeof globalThis & { pictor: PictorBridge }).pictor
        const settings = await bridge.saveSettings({
          apiProtocol: 'chat-completions',
          baseUrl,
          modelId: 'pictor-e2e-model',
          reasoningEffort: null,
          temperature: null,
          maxOutputTokens: 64,
          apiKey: { action: 'replace', value: apiKey },
        })
        const project = await bridge.registerProject({ rootPath, trusted: true })
        if (!project.ok) return { settings, project, session: null }
        const session = await bridge.createSession({ projectId: project.value.id })
        if (session.ok) {
          await bridge.selectContext({ projectId: project.value.id, sessionId: session.value.id })
        }
        return { settings, project, session }
      },
      {
        apiKey: credentialFixtures.runtimeRecovery,
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        rootPath: projectRoot,
      },
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
    await expect(window.getByText('失败').last()).toBeVisible({ timeout: 20_000 })
    expect(await readSelectedRunStatus(window)).toBe('failed')

    await composer.fill('Continue in the same session.')
    await expect(send).toBeEnabled()
    await send.click()
    await expect(window.getByText('Recovered after runtime failure.')).toBeVisible({
      timeout: 20_000,
    })
    await expect(window.getByText('已完成').last()).toBeVisible({ timeout: 30_000 })
    expect(await readSelectedRunStatus(window)).toBe('completed')

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
