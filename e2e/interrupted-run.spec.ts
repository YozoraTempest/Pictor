import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'

import type { PictorBridge } from '../src/shared/desktop-bridge.js'
import { credentialFixtures } from './support.js'

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
      async ({ apiKey, baseUrl, projectRoot }) => {
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
        const project = await bridge.registerProject({ rootPath: projectRoot, trusted: true })
        if (!project.ok) return { settings, project, session: null, run: null }
        const session = await bridge.createSession({ projectId: project.value.id })
        if (!session.ok) return { settings, project, session, run: null }
        const run = await bridge.startRun({ sessionId: session.value.id, prompt: 'Keep running.' })
        return { settings, project, session, run }
      },
      {
        apiKey: credentialFixtures.interruptedRun,
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        projectRoot,
      },
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
