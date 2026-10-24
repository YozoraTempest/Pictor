import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { startStubModel } from '../stub-model.mjs'

/**
 * One conversation, from the composer to the runtime and back.
 *
 * This is the path that broke without any unit test noticing — a subscription
 * that never received anything, a reopen that showed an empty transcript, a
 * placeholder title that never changed — so the spec walks it end to end and
 * asserts only what a person would see: their words, the answer as it arrives,
 * the adopted title, and the same conversation after a restart.
 *
 * The model is a local stub, so every assertion is about Pictor and the runtime,
 * never about a provider's output.
 */
export default {
  name: 'chat round trip',
  async run(page, app) {
    // The runtime is a package the app installs into a profile; e2e never
    // installs anything, so a machine without one skips instead of failing.
    if (app.dsh === null) {
      return { skip: '没有找到 DeepSeek 运行时；设置 PICTOR_DSH_BIN 或先运行一次应用' }
    }

    const reply = '流式链路：端到端正常。'
    const title = 'e2e 采纳的标题'
    const model = await startStubModel({ reply, title })

    try {
      // Setup goes through the same bridge the settings page uses; the subject of
      // the spec starts at the composer.
      await page.evaluate(
        (baseUrl) =>
          window.pictor.saveProvider({
            name: 'e2e 模型',
            baseUrl,
            protocol: 'openai-completions',
            modelId: 'stub-model',
            models: [{ id: 'stub-model' }],
            apiKey: 'e2e-key',
          }),
        model.baseUrl,
      )

      // A conversation runs against the directory the runtime was started in, and
      // the archive spec already registered the workdir itself.
      const directory = join(app.workdir, 'chat')
      mkdirSync(directory, { recursive: true })
      const status = await page.evaluate((cwd) => window.pictor.harnessStart(cwd), directory)
      assert.equal(status.state, 'ready', `the runtime booted: ${status.error ?? ''}`)

      await page.reload()
      await page.waitForSelector('header', { timeout: 30_000 })

      // A conversation the way the shortcut makes one: Pictor writes its
      // placeholder title, which is what lets the runtime's own title replace it.
      await page.keyboard.press('Control+n')

      const input = page.getByLabel('消息输入')
      await input.fill('说三句话')
      await input.press('Enter')

      // The answer arrives through the follow stream; a broken subscription shows
      // up here as a timeout rather than as an empty transcript.
      await page.getByText(reply).first().waitFor({ timeout: 60_000 })
      assert.ok(
        model.requests.some((line) => line.endsWith('/chat/completions')),
        'the runtime reached the model endpoint',
      )

      // The runtime names the conversation after its first turn, and Pictor adopts
      // that name over the placeholder it wrote at creation.
      await page.getByRole('button', { name: title }).first().waitFor({ timeout: 30_000 })

      // A reopen reads the transcript back from the runtime: this is the check
      // that used to pass against an empty history.
      await page.reload()
      await page.waitForSelector('header', { timeout: 30_000 })
      await page.getByRole('button', { name: title }).first().click({ timeout: 15_000 })
      await page.getByText(reply).first().waitFor({ timeout: 30_000 })
    } finally {
      await model.close()
    }
  },
}
