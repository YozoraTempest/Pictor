import { _electron as electron, expect, test } from '@playwright/test'
import { resolve } from 'node:path'

import { bridgeKeys, moduleBridgeKeys } from './support.js'

test('launches a sandboxed, nonblank desktop shell', async ({
  browserName: _browserName,
}, testInfo) => {
  const electronApp = await electron.launch({
    args: [
      resolve('out/main/index.js'),
      `--user-data-dir=${testInfo.outputPath('shell-user-data')}`,
    ],
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
      bridgeKeys: Object.keys((globalThis as typeof globalThis & { pictor: object }).pictor),
      moduleBridgeKeys: Object.keys(
        (globalThis as typeof globalThis & { pictorModules: object }).pictorModules,
      ),
      nodeProcessType: typeof Reflect.get(globalThis, 'process'),
    }))

    expect(rendererGlobals.bridgeKeys.sort()).toEqual(bridgeKeys.toSorted())
    expect(rendererGlobals.moduleBridgeKeys.sort()).toEqual(moduleBridgeKeys.toSorted())
    expect(rendererGlobals.nodeProcessType).toBe('undefined')

    await window.getByRole('button', { name: '设置' }).click()
    await window.getByRole('button', { name: '关于' }).click()
    await expect(window.getByRole('heading', { name: '应用更新' })).toBeVisible()
    await expect(window.getByText('MIT', { exact: true })).toBeVisible()
    await expect(window.getByRole('button', { name: '检查更新' })).toBeVisible()

    await window.screenshot({ path: testInfo.outputPath('pictor-shell.png') })
  } finally {
    await electronApp.close()
  }
})
