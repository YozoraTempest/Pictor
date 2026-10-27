import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * A plugin that arrives while the window is already open.
 *
 * This is the promise the settings page makes — 「装完不用重启」 — and it used to be half
 * true: the kernel half mounted live, while the panel list was a snapshot taken at
 * launch, so a plugin's panel appeared only after the next start. The spec writes a
 * plugin on the spot, installs it through IPC, and then looks at the column that was
 * drawn before the plugin existed.
 */
const PLUGIN = {
  'package.json': JSON.stringify(
    {
      name: '@acme/late-panel',
      version: '1.0.0',
      type: 'module',
      main: 'index.js',
      pictor: { id: 'acme.late-panel', engines: { pictor: '>=0.0.0' } },
    },
    null,
    2,
  ),
  // A cordis plugin, written the way dsh writes them: `inject` names the services it
  // needs and `apply` registers through them. Cordis owns the lifetime, so an uninstall
  // runs the disposer and the panel goes with it.
  'index.js': [
    "export const inject = ['pictor']",
    'export function apply(ctx) {',
    '  ctx.effect(() =>',
    '    ctx.pictor.views({',
    "      id: 'acme.late.today',",
    "      title: '迟到的视图',",
    "      data: () => ({ blocks: [{ kind: 'text', text: '我是装完才出现的' }] }),",
    '    }),',
    '  )',
    '  ctx.effect(() =>',
    '    ctx.pictor.panels({',
    "      id: 'acme.late.panel',",
    "      title: '迟到的面板',",
    "      view: 'acme.late.today',",
    '    }),',
    '  )',
    '}',
    '',
  ].join('\n'),
}

export default {
  name: '装完即用',
  async run(page) {
    // The column has to be showing before a row can be looked for in it: on a narrow
    // window it is collapsed, and a collapsed column has no rows to click.
    const opener = page.getByRole('button', { name: '展开右侧面板' })
    if ((await opener.count()) > 0) await opener.click()

    const source = join(mkdtempSync(join(tmpdir(), 'pictor-plugin-')), 'late-panel')
    mkdirSync(source, { recursive: true })
    for (const [name, body] of Object.entries(PLUGIN)) writeFileSync(join(source, name), body)

    const installed = await page.evaluate(
      (directory) => window.pictor.installKernelFolder(directory),
      source,
    )
    assert.equal(installed.ok, true, installed.message)

    // No reload, no restart: the row has to appear in a column that was already drawn.
    const row = page.getByRole('button', { name: /迟到的面板/ })
    await row.waitFor({ timeout: 30_000 })
    await row.click()
    await page.getByText('我是装完才出现的').waitFor({ timeout: 20_000 })
    await page.getByRole('button', { name: '返回面板列表' }).click()

    // Off again: a switch that only writes a record and leaves the plugin running is a
    // promise the app does not keep, so the row has to leave on the same click.
    assert.equal(
      await page.evaluate(() => window.pictor.setPluginEnabled('acme.late-panel', false)),
      false,
    )
    await row.waitFor({ state: 'detached', timeout: 30_000 })

    // And back, because switching off is a setting, not a deletion.
    assert.equal(
      await page.evaluate(() => window.pictor.setPluginEnabled('acme.late-panel', true)),
      true,
    )
    await row.waitFor({ timeout: 30_000 })
  },
}
