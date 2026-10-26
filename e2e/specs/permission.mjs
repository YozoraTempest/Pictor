import assert from 'node:assert/strict'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { startStubModel } from '../stub-model.mjs'

/**
 * The sandbox switch in the composer, which belongs to one conversation.
 *
 * Two things are invisible to a unit test: that the switch reaches the runtime
 * (the file is really refused) and that it stays on that conversation (a new one
 * starts at the default). Both are checked here against a real sandbox.
 */
export default {
  name: '会话权限',
  async run(page, app) {
    if (app.dsh === null) {
      return { skip: '没有找到 DeepSeek 运行时；设置 PICTOR_DSH_BIN 或先运行一次应用' }
    }

    const workdir = join(app.workdir, 'permission')
    mkdirSync(workdir, { recursive: true })
    const target = join(workdir, 'written.txt')
    const model = await startStubModel({
      reply: '处理完了。',
      toolCalls: [{ name: 'write', arguments: { file_path: target, content: 'hello' } }],
    })

    try {
      const listed = await page.evaluate(
        (baseUrl) =>
          window.pictor.saveProvider({
            name: 'e2e 权限',
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
      await page.evaluate(() => window.pictor.harnessStop())
      const status = await page.evaluate((cwd) => window.pictor.harnessStart(cwd), workdir)
      assert.equal(status.state, 'ready', `the runtime booted: ${status.error ?? ''}`)

      await page.reload()
      await page.waitForSelector('header', { timeout: 30_000 })
      await page.keyboard.press('Control+n')
      const trigger = page.getByLabel(/会话权限/)
      await trigger.waitFor({ timeout: 20_000 })
      assert.match(
        (await trigger.getAttribute('aria-label')) ?? '',
        /工作区可写/,
        'a new conversation starts at the stored default',
      )

      // Narrow this conversation, then prove the sandbox followed it.
      await trigger.click()
      await page.getByRole('dialog', { name: '会话权限' }).waitFor({ timeout: 5_000 })
      await page.getByRole('button', { name: /只读/ }).first().click()
      await trigger.waitFor({ timeout: 10_000 })
      await page.waitForTimeout(600)
      assert.match(
        (await trigger.getAttribute('aria-label')) ?? '',
        /只读/,
        'the switch took effect',
      )

      const input = page.getByLabel('消息输入')
      await input.fill('写一个文件')
      await input.press('Enter')
      await page.getByText('处理完了。').first().waitFor({ timeout: 60_000 })
      assert.ok(
        model.calls.some((call) => call.toolText.includes('denied')),
        'read-only refused the write',
      )

      // A second conversation must not inherit the narrower mode.
      await page.keyboard.press('Control+n')
      const fresh = page.getByLabel(/会话权限/)
      await fresh.waitFor({ timeout: 15_000 })
      assert.match(
        (await fresh.getAttribute('aria-label')) ?? '',
        /工作区可写/,
        'the switch stayed on the conversation it was made in',
      )

      const inputB = page.getByLabel('消息输入')
      await inputB.fill('再写一个文件')
      await inputB.press('Enter')
      await page.getByText('处理完了。').last().waitFor({ timeout: 60_000 })
      assert.ok(existsSync(target), 'the default mode allowed the same write')
    } finally {
      await model.close()
    }
  },
}
