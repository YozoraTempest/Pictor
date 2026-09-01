import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { defaultPluginProfile } from '../src/main/plugins/default-profile.js'
import { PluginStore } from '../src/main/plugins/plugin-store.js'

async function writeDevelopmentRendererPlugin(
  root: string,
  id: string,
  rendererSource: string,
): Promise<void> {
  await mkdir(join(root, 'dist'), { recursive: true })
  await writeFile(
    join(root, 'manifest.json'),
    `${JSON.stringify({
      id,
      name: id,
      version: '0.3.0',
      description: 'E2E development renderer plugin',
      engines: { pictor: '^0.3.0' },
      dependencies: {},
      modules: { renderer: './dist/renderer.js' },
    })}\n`,
  )
  await writeFile(join(root, 'dist', 'renderer.js'), rendererSource)
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
    await expect(window.getByText('pictor.updater', { exact: true })).toBeVisible({
      timeout: 30_000,
    })
    const updaterRow = window.locator('.plugin-row').filter({ hasText: 'pictor.updater' })
    await expect(updaterRow.getByText('运行中')).toBeVisible()
    expect(rendererErrors).toEqual([])
    const commandTransport = await window.evaluate(async () => {
      const client = (
        globalThis as typeof globalThis & {
          pictor: {
            commands: {
              list: (filter?: { query?: string }) => Promise<Array<{ id: string }>>
              execute: (
                commandId: string,
                input: unknown,
                context: { frontend: 'gui' },
              ) => Promise<{ executionId: string }>
              subscribe: (
                executionId: string,
                listener: (event: { type: string }) => void,
              ) => () => void
            }
          }
        }
      ).pictor.commands
      const descriptors = await client.list({ query: 'plugin' })
      const execution = await client.execute('plugin.list', null, { frontend: 'gui' })
      const events = await new Promise<string[]>((resolve) => {
        const received: string[] = []
        let finished = false
        let release: (() => void) | null = null
        const finish = (): void => {
          if (finished) return
          finished = true
          resolve(received)
          release?.()
        }
        release = client.subscribe(execution.executionId, (event) => {
          received.push(event.type)
          if (event.type === 'completed' || event.type === 'failed' || event.type === 'cancelled') {
            finish()
          }
        })
        if (finished) release()
      })
      return { ids: descriptors.map(({ id }) => id), events }
    })
    expect(commandTransport.ids).toEqual(
      expect.arrayContaining([
        'plugin.list',
        'plugin.install',
        'plugin.enable',
        'plugin.disable',
        'plugin.remove',
        'plugin.restore',
      ]),
    )
    expect(commandTransport.events).toEqual(['started', 'completed'])
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
    await expect(window.getByRole('button', { name: '恢复' })).toBeVisible({ timeout: 30_000 })
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

test('starts the Pictor Shell with all Plugins ignored in safe mode', async ({
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
    await expect(window.getByRole('heading', { name: 'Pictor Shell' })).toBeVisible()
    await expect(window.getByText('安全模式已忽略全部 Plugin')).toBeVisible()
    await expect(window.getByText('已禁用')).toHaveCount(7)
    await expect(window.getByText('app.doctor', { exact: true })).toBeVisible()
    await window.getByRole('button', { name: '应用诊断' }).click()
    await expect(window.getByRole('heading', { name: 'app.doctor' })).toBeVisible()
  } finally {
    await electronApp.close()
  }
})

test('starts the Pictor Shell after every Bundled Plugin is removed', async ({
  browserName: _browserName,
}, testInfo) => {
  const userDataDirectory = testInfo.outputPath('zero-plugin-user-data')
  const store = await initializePluginStore(userDataDirectory)
  const installed = (await store.getSnapshot()).registry.entries.filter(
    (entry) => entry.kind === 'pictor-plugin',
  )
  for (const entry of installed) await store.remove(entry.id)

  const launch = () =>
    electron.launch({
      args: [resolve('out/main/index.js'), `--user-data-dir=${userDataDirectory}`],
      cwd: resolve('.'),
    })
  const electronApp = await launch()
  try {
    const window = await electronApp.firstWindow()
    await expect(window.getByRole('heading', { name: 'Pictor Shell' })).toBeVisible()
    await expect(window.getByRole('button', { name: '恢复' })).toHaveCount(7)
    const workspaceRow = window
      .locator('.pictor-shell__plugin-row')
      .filter({ hasText: 'pictor.agent-workspace' })
    await workspaceRow.getByRole('button', { name: '恢复' }).click()
    await expect(window.getByText('操作已记录；重启 Pictor 后生效。')).toBeVisible()
  } finally {
    await electronApp.close()
  }

  const restoredApp = await launch()
  try {
    const window = await restoredApp.firstWindow()
    await expect(window.getByRole('heading', { name: '选择一个项目开始' })).toBeVisible()
  } finally {
    await restoredApp.close()
  }
})

test('shows all Workbench owners in a conflict Shell and can disable the conflicting Plugin', async ({
  browserName: _browserName,
}, testInfo) => {
  const userDataDirectory = testInfo.outputPath('conflict-user-data')
  const pluginRoot = testInfo.outputPath('conflict-plugin')
  await writeDevelopmentRendererPlugin(
    pluginRoot,
    'pictor.conflict-workbench',
    `export default ({ pluginId }) => [{
      id: 'pictor.conflict-workbench.renderer',
      activate(context) {
        context.contribute({ id: 'gui.workbenches' }, {
          id: 'conflict-workbench',
          pluginId,
          render() { return null }
        })
      }
    }]\n`,
  )
  const store = await initializePluginStore(userDataDirectory)
  await store.installDevelopmentFromDirectory(pluginRoot)

  const electronApp = await electron.launch({
    args: [resolve('out/main/index.js'), `--user-data-dir=${userDataDirectory}`],
    cwd: resolve('.'),
  })
  try {
    const window = await electronApp.firstWindow()
    await expect(window.getByRole('heading', { name: 'Pictor Shell' })).toBeVisible()
    await expect(window.getByText('Workbench 冲突')).toBeVisible()
    await expect(window.getByText('agent-workspace', { exact: true })).toBeVisible()
    await expect(window.getByText('conflict-workbench', { exact: true })).toBeVisible()
    const pluginList = window.locator('.pictor-shell__plugin-list')
    await expect(
      pluginList.locator('.pictor-shell__plugin-row').filter({ hasText: 'pictor.agent-workspace' }),
    ).toBeVisible()
    await expect(
      pluginList
        .locator('.pictor-shell__plugin-row')
        .filter({ hasText: 'pictor.conflict-workbench' }),
    ).toBeVisible()

    const conflictRow = window
      .locator('.pictor-shell__plugin-row')
      .filter({ hasText: 'pictor.conflict-workbench' })
    await conflictRow.getByRole('button', { name: '禁用 pictor.conflict-workbench' }).click()
    await expect(window.getByText('操作已记录；重启 Pictor 后生效。')).toBeVisible()
  } finally {
    await electronApp.close()
  }
})

test('isolates a failed Renderer Plugin and enters Shell without a Workbench', async ({
  browserName: _browserName,
}, testInfo) => {
  const userDataDirectory = testInfo.outputPath('failed-renderer-user-data')
  const pluginRoot = testInfo.outputPath('failed-renderer-plugin')
  await writeDevelopmentRendererPlugin(
    pluginRoot,
    'pictor.failed-renderer',
    `export default () => [{
      id: 'pictor.failed-renderer.renderer',
      activate() { throw new Error('temporary Renderer activation failed') }
    }]\n`,
  )
  const store = await initializePluginStore(userDataDirectory)
  const bundledEntries = (await store.getSnapshot()).registry.entries.filter(
    (entry) => entry.kind === 'pictor-plugin',
  )
  for (const entry of bundledEntries) await store.remove(entry.id)
  await store.installDevelopmentFromDirectory(pluginRoot)

  const electronApp = await electron.launch({
    args: [resolve('out/main/index.js'), `--user-data-dir=${userDataDirectory}`],
    cwd: resolve('.'),
  })
  try {
    const window = await electronApp.firstWindow()
    await expect(window.getByRole('heading', { name: 'Pictor Shell' })).toBeVisible()
    await expect(window.getByText('Renderer Plugin 加载失败', { exact: true })).toBeVisible()
    await expect(
      window.locator('.pictor-shell__plugin-row').filter({ hasText: 'pictor.failed-renderer' }),
    ).toBeVisible()
    await expect(
      window.getByText('temporary Renderer activation failed', { exact: true }),
    ).toBeVisible()
  } finally {
    await electronApp.close()
  }
})
