import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'

import {
  credentialFixtures,
  invokeAgentWorkspace,
  readSelectedRunStatus,
  writeChatText,
} from './support.js'
import { closeElectronApp } from './electron-cleanup.js'

test('@smoke completes one delegated response through the real runtime', async ({
  browserName: _browserName,
}, testInfo) => {
  let requestCount = 0
  const server = createServer(async (request, response) => {
    for await (const chunk of request) void chunk
    requestCount += 1
    writeChatText(response, 'Delegated response completed.')
  })
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
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
  let businessFailed = false

  try {
    const window = await electronApp.firstWindow()
    const settings = await invokeAgentWorkspace(window, 'saveSettings', {
      apiProtocol: 'chat-completions',
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      modelId: 'pictor-e2e-model',
      reasoningEffort: null,
      temperature: null,
      maxOutputTokens: 64,
      apiKey: { action: 'replace', value: credentialFixtures.localRuntime },
    })
    const project = await invokeAgentWorkspace(window, 'registerProject', {
      rootPath: projectRoot,
      trusted: true,
    })
    const session = project.ok
      ? await invokeAgentWorkspace(window, 'createSession', { projectId: project.value.id })
      : null
    if (project.ok && session?.ok) {
      await invokeAgentWorkspace(window, 'selectContext', {
        projectId: project.value.id,
        sessionId: session.value.id,
      })
    }
    expect(settings.ok).toBe(true)
    expect(project.ok).toBe(true)
    expect(session?.ok).toBe(true)

    await window.reload()
    const composer = window.getByRole('textbox', { name: '任务描述' })
    await composer.fill('Return one delegated response.')
    await window.getByRole('button', { name: '发送任务' }).click()

    await expect(window.getByText('Delegated response completed.')).toBeVisible({
      timeout: 30_000,
    })
    await expect(window.getByText('已完成').last()).toBeVisible({ timeout: 30_000 })
    expect(await readSelectedRunStatus(window)).toBe('completed')
    expect(requestCount).toBe(1)
  } catch (error) {
    businessFailed = true
    throw error
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
