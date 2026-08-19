import { _electron as electron, expect, test } from '@playwright/test'
import { resolve } from 'node:path'

import { defaultPluginProfile } from '../src/main/plugins/default-profile.js'
import { PluginStore } from '../src/main/plugins/plugin-store.js'

test('removes and restores the Bundled Updater through the Core Plugin Manager', async ({
  browserName: _browserName,
}, testInfo) => {
  const userDataArgument = `--user-data-dir=${testInfo.outputPath('plugin-user-data')}`
  const launch = () =>
    electron.launch({ args: [resolve('out/main/index.js'), userDataArgument], cwd: resolve('.') })

  const firstApp = await launch()
  try {
    const window = await firstApp.firstWindow()
    const rendererErrors: string[] = []
    window.on('console', (message) => {
      if (message.type() === 'error') rendererErrors.push(message.text())
    })
    window.on('pageerror', (error) => rendererErrors.push(error.message))
    await expect(window.getByRole('heading', { name: '选择一个项目开始' })).toBeVisible()
    await window.getByRole('button', { name: '设置' }).click()
    await window.getByRole('button', { name: 'Plugins' }).click()
    await expect(window.getByText('pictor.updater', { exact: true })).toBeVisible()
    const updaterRow = window.locator('.plugin-row').filter({ hasText: 'pictor.updater' })
    await expect(updaterRow.getByText('运行中')).toBeVisible()
    expect(rendererErrors).toEqual([])
    const rendererImport = await window.evaluate(async () => {
      const bridge = (
        globalThis as typeof globalThis & {
          pictor: { getPluginBootstrap: () => Promise<unknown> }
        }
      ).pictor
      const bootstrap = (await bridge.getPluginBootstrap()) as {
        ok: boolean
        value?: { plugins: Array<{ rendererEntryUrl: string | null }> }
      }
      const url = bootstrap.value?.plugins.find(
        (plugin) => plugin.rendererEntryUrl,
      )?.rendererEntryUrl
      if (!url) return { ok: false, error: 'missing renderer URL' }
      try {
        const namespace = await import(url)
        return { ok: true, keys: Object.keys(namespace) }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    })
    expect(rendererImport).toEqual({ ok: true, keys: ['default'] })
    await window.getByRole('button', { name: '关于' }).click()
    await expect(window.getByRole('heading', { name: '应用更新' })).toBeVisible()
    await window.getByRole('button', { name: 'Plugins' }).click()
    await window.getByRole('button', { name: '移除 Updater', exact: true }).click()
    await expect(window.getByText('重启 Pictor 后应用 Plugin 变更')).toBeVisible()
  } finally {
    await firstApp.close()
  }

  const removedApp = await launch()
  try {
    const window = await removedApp.firstWindow()
    await expect(window.getByRole('heading', { name: '选择一个项目开始' })).toBeVisible()
    await window.getByRole('button', { name: '设置' }).click()
    await expect(window.getByRole('button', { name: '关于' })).toHaveCount(0)
    await window.getByRole('button', { name: 'Plugins' }).click()
    await expect(window.getByRole('button', { name: '恢复' })).toBeVisible()
    await window.getByRole('button', { name: '恢复' }).click()
    await expect(window.getByText('重启 Pictor 后应用 Plugin 变更')).toBeVisible()
  } finally {
    await removedApp.close()
  }

  const restoredApp = await launch()
  try {
    const window = await restoredApp.firstWindow()
    await expect(window.getByRole('heading', { name: '选择一个项目开始' })).toBeVisible()
    await window.getByRole('button', { name: '设置' }).click()
    await window.getByRole('button', { name: '关于' }).click()
    await expect(window.getByRole('heading', { name: '应用更新' })).toBeVisible()
  } finally {
    await restoredApp.close()
  }
})

test('starts the Core Plugin Manager with all Plugins ignored in safe mode', async ({
  browserName: _browserName,
}, testInfo) => {
  const electronApp = await electron.launch({
    args: [
      resolve('out/main/index.js'),
      '--safe-mode',
      `--user-data-dir=${testInfo.outputPath('safe-mode-user-data')}`,
    ],
    cwd: resolve('.'),
  })

  try {
    const window = await electronApp.firstWindow()
    await expect(window.getByRole('heading', { name: 'Plugin Manager' })).toBeVisible()
    await window.getByRole('button', { name: '打开 Plugin Manager' }).click()
    await expect(window.getByText('安全模式已忽略全部 Plugin')).toBeVisible()
    await expect(window.getByText('已禁用')).toHaveCount(4)
  } finally {
    await electronApp.close()
  }
})

test('starts the Core Shell after every Bundled Plugin is removed', async ({
  browserName: _browserName,
}, testInfo) => {
  const userDataDirectory = testInfo.outputPath('zero-plugin-user-data')
  const store = new PluginStore({
    userDataDirectory,
    bundledPluginsDirectory: resolve('.pictor/bundled-plugins'),
    profile: defaultPluginProfile,
  })
  await store.initialize()
  const installed = (await store.getSnapshot()).registry.entries.filter(
    (entry) => entry.kind === 'pictor-plugin',
  )
  for (const entry of installed) await store.remove(entry.id)

  const electronApp = await electron.launch({
    args: [resolve('out/main/index.js'), `--user-data-dir=${userDataDirectory}`],
    cwd: resolve('.'),
  })
  try {
    const window = await electronApp.firstWindow()
    await expect(window.getByRole('heading', { name: 'Plugin Manager' })).toBeVisible()
    await window.getByRole('button', { name: '打开 Plugin Manager' }).click()
    await expect(window.getByRole('button', { name: '恢复' })).toHaveCount(4)
  } finally {
    await electronApp.close()
  }
})
