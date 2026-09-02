import { _electron as electron, expect, test } from '@playwright/test'
import { resolve } from 'node:path'

import { defaultPluginProfile } from '../src/main/plugins/default-profile.js'
import { PluginStore } from '../src/main/plugins/plugin-store.js'

function launch(userDataDirectory: string) {
  return electron.launch({
    args: [resolve('out/main/index.js'), `--user-data-dir=${userDataDirectory}`],
    cwd: resolve('.'),
  })
}

async function initializePluginStore(userDataDirectory: string): Promise<PluginStore> {
  const store = new PluginStore({
    userDataDirectory,
    bundledPluginsDirectory: resolve('.pictor/bundled-plugins'),
    profile: defaultPluginProfile,
  })
  await store.initialize()
  return store
}

test('removes and restores a Bundled Plugin across real application restarts', async ({
  browserName: _browserName,
}, testInfo) => {
  const userDataDirectory = testInfo.outputPath('plugin-user-data')

  const firstApp = await launch(userDataDirectory)
  try {
    const window = await firstApp.firstWindow()
    await expect(window.getByRole('heading', { name: '选择一个项目开始' })).toBeVisible()
    await window.getByRole('button', { name: '设置' }).click()
    await window.getByRole('button', { name: 'Plugins' }).click()
    const updaterRow = window.locator('.plugin-row').filter({ hasText: 'pictor.updater' })
    await expect(updaterRow.getByText('运行中')).toBeVisible({ timeout: 30_000 })
    await window.getByRole('button', { name: '移除 Updater', exact: true }).click()
    await expect(window.getByText('重启 Pictor 后应用 Plugin 变更')).toBeVisible()
  } finally {
    await firstApp.close()
  }

  const removedApp = await launch(userDataDirectory)
  try {
    const window = await removedApp.firstWindow()
    await expect(window.getByRole('heading', { name: '选择一个项目开始' })).toBeVisible()
    await window.getByRole('button', { name: '设置' }).click()
    await expect(window.getByRole('button', { name: '关于' })).toHaveCount(0)
    await window.getByRole('button', { name: 'Plugins' }).click()
    await window.getByRole('button', { name: '恢复' }).click()
    await expect(window.getByText('重启 Pictor 后应用 Plugin 变更')).toBeVisible()
  } finally {
    await removedApp.close()
  }

  const restoredApp = await launch(userDataDirectory)
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

test('starts the Core Shell after every Bundled Plugin is removed and restores the Workbench', async ({
  browserName: _browserName,
}, testInfo) => {
  const userDataDirectory = testInfo.outputPath('zero-plugin-user-data')
  const store = await initializePluginStore(userDataDirectory)
  const installed = (await store.getSnapshot()).registry.entries.filter(
    (entry) => entry.kind === 'pictor-plugin',
  )
  for (const entry of installed) await store.remove(entry.id)

  const shellApp = await launch(userDataDirectory)
  try {
    const window = await shellApp.firstWindow()
    await expect(window.getByRole('heading', { name: 'Pictor Shell' })).toBeVisible()
    await expect(window.getByRole('button', { name: '恢复' })).toHaveCount(10)
    const workspaceRow = window
      .locator('.pictor-shell__plugin-row')
      .filter({ hasText: 'pictor.agent-workspace' })
    const workbenchRow = window
      .locator('.pictor-shell__plugin-row')
      .filter({ hasText: 'pictor.workbench.delegate' })
    await workspaceRow.getByRole('button', { name: '恢复' }).click()
    await workbenchRow.getByRole('button', { name: '恢复' }).click()
    await expect(window.getByText('操作已记录；重启 Pictor 后生效。')).toBeVisible()
  } finally {
    await shellApp.close()
  }

  const restoredApp = await launch(userDataDirectory)
  try {
    const window = await restoredApp.firstWindow()
    await expect(window.getByRole('heading', { name: '选择一个项目开始' })).toBeVisible()
  } finally {
    await restoredApp.close()
  }
})
