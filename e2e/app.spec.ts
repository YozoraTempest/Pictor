import { _electron as electron, expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import type { PictorBridge } from '../src/shared/contracts.js'

const bridgeKeys = [
  'createSession',
  'deleteSession',
  'getAppInfo',
  'getSession',
  'getSettings',
  'getSnapshot',
  'pickProjectDirectory',
  'registerProject',
  'removeProject',
  'renameSession',
  'saveSettings',
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

    expect(rendererGlobals.bridgeKeys.sort()).toEqual(bridgeKeys)
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
