import assert from 'node:assert/strict'
import { join } from 'node:path'

import { startStubModel } from '../stub-model.mjs'

/**
 * A tool rule, from the settings list to a refused tool call.
 *
 * The rule runs in the main process and reaches the kernel over the guard
 * bridge, so nothing about it is visible to a unit test: only a real call can
 * show that the refusal happens, and that removing the rule lets the same call
 * through again.
 */
export default {
  name: '工具规则',
  async run(page, app) {
    if (app.dsh === null) {
      return { skip: '没有找到 DeepSeek 运行时；设置 PICTOR_DSH_BIN 或先运行一次应用' }
    }

    const model = await startStubModel({
      reply: '做完了。',
      // Harmless, so the allowed half of the spec is safe to run for real.
      toolCalls: [{ name: 'bash', arguments: { command: 'echo ruled', description: '打印标记' } }],
    })

    try {
      const listed = await page.evaluate(
        (baseUrl) =>
          window.pictor.saveProvider({
            name: 'e2e 规则',
            baseUrl,
            protocol: 'openai-completions',
            modelId: 'stub-model',
            models: [{ id: 'stub-model' }],
            apiKey: 'e2e-key',
          }),
        model.baseUrl,
      )
      const provider = listed.providers.find((entry) => entry.baseUrl === model.baseUrl)
      assert.ok(provider !== undefined, 'the provider was saved')
      await page.evaluate((id) => window.pictor.activateProvider(id), provider.id)

      const saved = await page.evaluate(() =>
        window.pictor.saveToolRules([
          { id: 'e2e-rule', effect: 'deny', tool: 'bash', pattern: 'echo ruled*' },
        ]),
      )
      assert.equal(saved.length, 1, 'the rule was stored')

      await page.evaluate((cwd) => window.pictor.harnessStart(cwd), join(app.workdir, 'rules'))
      await page.reload()
      await page.waitForSelector('header', { timeout: 30_000 })
      await page.keyboard.press('Control+n')

      const input = page.getByLabel('消息输入')
      await input.waitFor({ timeout: 20_000 })
      await input.fill('执行一下')
      await input.press('Enter')
      await page.getByText('做完了。').first().waitFor({ timeout: 60_000 })
      assert.ok(
        model.calls.some((call) => call.toolText.includes('被工具规则拦截')),
        'the rule refused the call before it ran',
      )

      // Removing the rule has to take effect for the next call, not the next boot.
      await page.evaluate(() => window.pictor.saveToolRules([]))
      await page.keyboard.press('Control+n')
      const second = page.getByLabel('消息输入')
      await second.waitFor({ timeout: 20_000 })
      await second.fill('再执行一下')
      await second.press('Enter')
      await page.getByText('做完了。').last().waitFor({ timeout: 60_000 })

      const last = model.calls.at(-1)?.toolText ?? ''
      assert.ok(last.includes('ruled'), 'the command ran once the rule was gone')
      assert.ok(!last.includes('被工具规则拦截'), 'nothing blocked it any more')
    } finally {
      await model.close()
    }
  },
}
