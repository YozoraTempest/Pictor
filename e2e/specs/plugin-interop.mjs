import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * A plugin written for the other side.
 *
 * dsh plugins are plain cordis plugins: `export const inject` and `export function
 * apply`, nothing in `package.json` beyond a `main`. Since both apps mount plugins into
 * a cordis tree, one package installs into both — what decides whether it *runs* is
 * which services it injects.
 *
 * So the two answers this spec pins down:
 *
 * - a cordis plugin asking for `pictor` runs here, with no `pictor` block to declare it;
 * - a cordis plugin asking for a service this host does not have stays mounted and
 *   waiting, reported as such rather than as broken.
 */
function write(parent, dir, manifest, source) {
  const root = join(parent, dir)
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest, null, 2))
  writeFileSync(join(root, 'index.js'), source)
  return root
}

export default {
  name: '插件互通',
  async run(page) {
    const parent = mkdtempSync(join(tmpdir(), 'pictor-interop-'))
    const opener = page.getByRole('button', { name: '展开右侧面板' })
    if ((await opener.count()) > 0) await opener.click()

    // 1. A cordis plugin, no `pictor` block anywhere.
    const mine = write(
      parent,
      'cordis-panel',
      { name: '@acme/cordis-panel', version: '1.0.0', type: 'module', main: 'index.js' },
      [
        "export const name = 'cordis-panel'",
        "export const inject = ['pictor']",
        'export function apply(ctx) {',
        '  ctx.effect(() =>',
        "    ctx.pictor.views({ id: 'acme.cordis.view', title: '互通视图', data: () => ({",
        "      blocks: [{ kind: 'text', text: '这个插件没有 pictor 字段' }],",
        '    }) }),',
        '  )',
        '  ctx.effect(() =>',
        "    ctx.pictor.panels({ id: 'acme.cordis.panel', title: '互通面板', view: 'acme.cordis.view' }),",
        '  )',
        '}',
        '',
      ].join('\n'),
    )

    const installed = await page.evaluate((dir) => window.pictor.installPlugin(`file:${dir}`), mine)
    assert.equal(installed.ok, true, installed.message)

    const row = page.getByRole('button', { name: /互通面板/ })
    await row.waitFor({ timeout: 30_000 })
    await row.click()
    await page.getByText('这个插件没有 pictor 字段').waitFor({ timeout: 20_000 })
    await page.getByRole('button', { name: '返回面板列表' }).click()

    // Its row says where it came from, and that it is a cordis plugin rather than a
    // Pictor one: the version line is the only place that difference is visible.
    const overview = await page.evaluate(() => window.pictor.listPluginOverview())
    const entry = overview.find((plugin) => plugin.id === '@acme/cordis-panel')
    assert.ok(entry !== undefined, '没有 pictor 字段的插件也要出现在列表里')
    assert.deepEqual(
      entry.contributions.map((one) => one.point).sort(),
      ['panels', 'views'],
      '贡献按它实际注册的算',
    )

    // 2. A plugin for the other side: it injects `tools`, which this host does not have.
    const other = write(
      parent,
      'dsh-tool',
      { name: '@acme/dsh-tool', version: '1.0.0', type: 'module', main: 'index.js' },
      [
        "export const name = 'dsh-tool'",
        "export const inject = ['tools']",
        'export function apply() {',
        "  throw new Error('不该跑到这里：宿主没有 tools 服务')",
        '}',
        '',
      ].join('\n'),
    )

    const second = await page.evaluate((dir) => window.pictor.installPlugin(`file:${dir}`), other)
    assert.equal(second.ok, true, second.message)

    const report = await page.evaluate(() => window.pictor.pluginReport())
    // Mounted, not running: waiting for a service. Reported as skipped, because calling
    // it active would be a lie and calling it failed would send someone hunting a bug.
    assert.equal(report.activated.includes('@acme/dsh-tool'), false, '缺服务的插件不该被算作已激活')
    assert.equal(report.skipped.includes('@acme/dsh-tool'), true, '等待中的插件要如实出现在跳过里')
    assert.equal(
      report.failures.some((failure) => failure.reason.includes('dsh-tool')),
      false,
      '等待不是失败',
    )

    // Both go away with the plugins that brought them.
    for (const name of ['cordis-panel', 'dsh-tool']) {
      await page.evaluate((dir) => window.pictor.removePlugin(dir), name)
    }
    await row.waitFor({ state: 'detached', timeout: 20_000 })
  },
}
