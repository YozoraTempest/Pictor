import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Editing a plugin while the app runs.
 *
 * `@deepseek-ai/cordis-plugin-hmr` — the package dsh uses — needs `--expose-internals`,
 * which Electron refuses in `NODE_OPTIONS` and swallows on the command line. So the app
 * does the part that does not need Node internals: watch the plugin's directory, unload
 * its fiber, and import the file again under a new URL. This spec is the whole promise:
 * write a file, and the panel is different without a restart.
 */
const source = (title) =>
  [
    "export const inject = ['pictor']",
    'export function apply(ctx) {',
    '  ctx.effect(() =>',
    '    ctx.pictor.views({',
    "      id: 'acme.hot.view',",
    `      title: '${title}',`,
    `      data: () => ({ blocks: [{ kind: 'text', text: '版本：${title}' }] }),`,
    '    }),',
    '  )',
    '  ctx.effect(() =>',
    "    ctx.pictor.panels({ id: 'acme.hot.panel', title: '热重载面板', view: 'acme.hot.view' }),",
    '  )',
    '}',
    '',
  ].join('\n')

export default {
  name: '热重载',
  async run(page, app) {
    const parent = mkdtempSync(join(tmpdir(), 'pictor-hot-'))
    const dir = join(parent, 'hot-panel')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: '@acme/hot-panel',
        version: '1.0.0',
        type: 'module',
        main: 'index.js',
      }),
    )
    writeFileSync(join(dir, 'index.js'), source('v1'))

    // Start from a fresh window. Earlier specs leave the app on whichever page and in
    // whichever column state they finished in, and a hidden or covered column would make
    // this spec fail for a reason that has nothing to do with reloading. Reloading the
    // window does not touch the main process, so the plugin being watched — and the
    // watcher itself — survive it.
    await page.reload()
    await page.waitForSelector('header', { timeout: 30_000 })
    const opener = page.getByRole('button', { name: '展开右侧面板' })
    if ((await opener.count()) > 0) await opener.click()

    // A failed earlier run can leave the plugin behind, and a second install of the same
    // name is refused — clean first so the spec is repeatable.
    await page.evaluate(() => window.pictor.removeKernel('hot-panel')).catch(() => undefined)

    const installed = await page.evaluate((path) => window.pictor.installKernelFolder(path), dir)
    assert.equal(installed.ok, true, installed.message)

    const row = page.getByRole('button', { name: /热重载面板/ })
    await row.waitFor({ timeout: 30_000 })
    // The column scrolls; by the time several specs have installed plugins the row can
    // be below the fold.
    await row.scrollIntoViewIfNeeded()
    await row.click()
    await page.getByText('版本：v1').waitFor({ timeout: 20_000 })

    // Edit the **installed** copy — the one the app mounted — not the source directory.
    // Installing copies the folder, so the two are different files from that point on.
    assert.ok(typeof app?.profile === 'string', 'e2e harness 应当给出 profile 路径')
    const installedFile = join(app.profile, 'plugins', 'hot-panel', 'index.js')
    writeFileSync(installedFile, source('v2'))

    // The panel body has to change on its own. It is showing v1, and the view is read
    // when opened — so the assertion re-opens it after the reload lands.
    const reloaded = await page.evaluate(async () => {
      const started = Date.now()
      while (Date.now() - started < 15_000) {
        const panels = await window.pictor.listPanels()
        if (panels.some((panel) => panel.id === 'acme.hot.panel')) {
          // A reload unloads and remounts, so the panel is briefly absent; the settled
          // state is what matters, and it is reached when the entry answers again.
          await new Promise((resolve) => setTimeout(resolve, 150))
          const views = await window.pictor.listPanels()
          if (views.some((panel) => panel.id === 'acme.hot.panel')) return true
        }
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
      return false
    })
    assert.equal(reloaded, true, '插件在文件改动后应当仍然挂载')

    // Close and reopen the panel: the view it draws is the edited one.
    await page.getByRole('button', { name: '返回面板列表' }).click()
    await row.scrollIntoViewIfNeeded()
    await row.click()
    await page.getByText('版本：v2').waitFor({ timeout: 20_000 })
    await page.getByRole('button', { name: '返回面板列表' }).click()

    const removed = await page.evaluate(() => window.pictor.removeKernel('hot-panel'))
    assert.equal(removed.ok, true, removed.message)
  },
}
