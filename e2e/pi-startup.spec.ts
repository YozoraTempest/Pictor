import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { credentialFixtures, invokeAgentWorkspace } from './support.js'

test('restores the selected Pi Session after the Renderer subscribes to runtime events', async ({
  browserName: _browserName,
}, testInfo) => {
  const userDataDirectory = testInfo.outputPath('pi-startup-user-data')
  const projectRoot = testInfo.outputPath('pi-startup-project')
  const extensionDirectory = resolve(projectRoot, '.pi', 'extensions')
  await mkdir(extensionDirectory, { recursive: true })
  await writeFile(
    resolve(extensionDirectory, 'startup-ui.ts'),
    `export default function (pi) {
  pi.on('session_start', async (_event, ctx) => {
    ctx.ui.setStatus('startup', 'Startup status')
    ctx.ui.setWidget('startup', ['Startup widget'])
    ctx.ui.setTitle('Pictor · Startup')
    await ctx.ui.input('Startup input', 'type a value')
  })
}
`,
  )

  const launch = () =>
    electron.launch({
      args: [resolve('out/main/index.js'), `--user-data-dir=${userDataDirectory}`],
      cwd: resolve('.'),
    })

  const sessionId = await (async (): Promise<string> => {
    const firstApp = await launch()
    const firstWindow = await firstApp.firstWindow()
    try {
      await firstWindow.waitForLoadState('domcontentloaded')
      const settings = await invokeAgentWorkspace(firstWindow, 'saveSettings', {
        apiProtocol: 'chat-completions',
        baseUrl: 'https://example.test/v1',
        modelId: 'pictor-startup-model',
        reasoningEffort: null,
        temperature: null,
        maxOutputTokens: 64,
        apiKey: { action: 'replace', value: credentialFixtures.localRuntime },
      })
      const project = await invokeAgentWorkspace(firstWindow, 'registerProject', {
        rootPath: projectRoot,
        trusted: true,
      })
      const session = project.ok
        ? await invokeAgentWorkspace(firstWindow, 'createSession', {
            projectId: project.value.id,
          })
        : null
      const setup = { settings, project, session }
      expect(setup).toMatchObject({
        settings: { ok: true },
        project: { ok: true },
        session: { ok: true },
      })
      if (!setup.project?.ok || !setup.session?.ok) throw new Error('Startup E2E setup failed')

      await firstWindow.reload()
      await expect(firstWindow.getByRole('heading', { name: '新建会话' })).toBeVisible()
      const selecting = invokeAgentWorkspace(firstWindow, 'selectContext', {
        projectId: setup.project.value.id,
        sessionId: setup.session.value.id,
      })
      await expect(firstWindow.getByRole('heading', { name: 'Startup input' })).toBeVisible({
        timeout: 30_000,
      })
      await expect(firstWindow.getByText('Startup status')).toBeVisible()
      await expect(firstWindow.getByText('Startup widget')).toBeVisible()
      await firstWindow.getByLabel('输入').fill('first start')
      await firstWindow.getByRole('button', { name: '确认' }).click()
      expect(await selecting).toEqual({ ok: true, value: null })
      return setup.session.value.id
    } finally {
      await firstApp.close()
    }
  })()

  const restoredApp = await launch()
  try {
    const restoredWindow = await restoredApp.firstWindow()
    await restoredWindow.waitForLoadState('domcontentloaded')
    await expect(restoredWindow.getByRole('heading', { name: 'Startup input' })).toBeVisible({
      timeout: 30_000,
    })
    await expect(restoredWindow.getByText('Startup status')).toBeVisible()
    await expect(restoredWindow.getByText('Startup widget')).toBeVisible()
    await expect(restoredWindow).toHaveTitle('Pictor · Startup')
    const controls = await invokeAgentWorkspace(restoredWindow, 'getSessionRuntimeControls', {
      sessionId,
    })
    expect(controls.ok).toBe(true)

    await restoredWindow.getByLabel('输入').fill('restored start')
    await restoredWindow.getByRole('button', { name: '确认' }).click()
  } finally {
    await restoredApp.close()
  }
})
