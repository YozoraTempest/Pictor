import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { openKernel } from '../harness.mjs'

/**
 * Writing a plugin is the whole workflow.
 *
 * No install step, no restart: a folder dropped into the development directory is mounted
 * by the time the page notices, and deleting it takes the plugin away again. This spec
 * writes real files with `node:fs` and then does nothing but wait — if the app needed a
 * manual rescan, nothing here would ever appear.
 *
 * The directory itself comes from the bridge rather than from a guess: the harness points
 * it at the run's own profile, so a test cannot write into a real home.
 */
export default {
  name: '插件开发',
  async run(page) {
    const homes = await page.evaluate(() => window.pictor.pluginHomes())
    assert.ok(
      homes.development.includes('development-plugins'),
      `e2e must not write into a real home (got ${homes.development})`,
    )

    // Open the page first: the row has to appear while it is on screen, which is the part
    // a restart-based discovery could not do.
    // 拓展 is a page in the engine's settings now, in the same column as 模型 and 运行时.
    await page
      .locator('nav[aria-label="主导航"] button[aria-label="DeepSeek Harness 设置"]')
      .click()
    await page.getByRole('button', { name: /拓展/ }).first().click()
    await page.getByRole('tab', { name: /插件/ }).click()
    await page.getByText('编辑后自动重载').waitFor({ timeout: 30_000 })

    const folder = join(homes.development, 'e2e-written')
    mkdirSync(folder, { recursive: true })
    writeFileSync(
      join(folder, 'package.json'),
      JSON.stringify({
        name: 'e2e-written',
        version: '1.0.0',
        type: 'module',
        main: 'index.js',
        pictor: { id: 'e2e.written', engines: { pictor: '>=0.0.0' } },
      }),
    )
    writeFileSync(
      join(folder, 'index.js'),
      `export const inject = ['pictor']
export function apply(ctx) {
  ctx.effect(() =>
    ctx.pictor.views({
      id: 'e2e.written.view',
      title: '写出来的视图',
      data: () => ({ blocks: [{ kind: 'text', text: '这个插件是刚写进磁盘的' }] }),
    }),
  )
  ctx.effect(() =>
    ctx.pictor.panels({ id: 'e2e.written.panel', title: '刚写的面板', view: 'e2e.written.view' }),
  )
}
`,
    )

    // No reload, no click: the row is expected on its own.
    // The package name is both the row's label and its id line, so the locator is counted
    // rather than resolved — `waitFor` on a two-element locator is a strict-mode violation.
    const rows = page.getByText('e2e-written', { exact: true })
    await rows.first().waitFor({ timeout: 30_000 })

    // And it is a working plugin, not just a row: its panel opens and draws. The panel
    // column belongs to the workspace, not to this page, so home is where to look.
    await openKernel(page, 'DeepSeek Harness')
    const opener = page.getByRole('button', { name: '展开右侧面板' })
    if ((await opener.count()) > 0) await opener.click()
    const panel = page.getByRole('button', { name: /刚写的面板/ })
    await panel.waitFor({ timeout: 20_000 })
    await panel.click({ timeout: 3_000 }).catch(() => panel.evaluate((element) => element.click()))
    await page.getByText('这个插件是刚写进磁盘的').waitFor({ timeout: 20_000 })

    // Deleting the folder is the other half of the same promise.
    rmSync(folder, { recursive: true, force: true })
    await page
      .getByRole('button', { name: '返回面板列表' })
      .click()
      .catch(() => undefined)

    // 拓展 is a page in the engine's settings now, in the same column as 模型 and 运行时.
    await page
      .locator('nav[aria-label="主导航"] button[aria-label="DeepSeek Harness 设置"]')
      .click()
    await page.getByRole('button', { name: /拓展/ }).first().click()
    await page.getByRole('tab', { name: /插件/ }).click()
    // The row goes without a restart, and it really goes: a poll, because a locator that
    // matches nothing is nothing to wait for.
    const gone = async () => (await rows.count()) === 0
    for (let attempt = 0; attempt < 60 && !(await gone()); attempt += 1) {
      await page.waitForTimeout(500)
    }
    assert.equal(await gone(), true, '删掉目录后插件行应该消失')
  },
}
