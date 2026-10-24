import assert from 'node:assert/strict'

import { startStubModel } from '../stub-model.mjs'

/**
 * The settings check runs a real turn, and a stalled runtime refuses instead of
 * quietly using another engine.
 *
 * 试运行 used to drive its own client, so it could pass while a conversation
 * failed. It now asks the runtime for one throwaway turn, which is the same path
 * a chat takes — and the second half of this spec pins the other side of that
 * decision: with no runtime, a message is refused and nothing else answers it.
 */
export default {
  name: '试运行',
  async run(page, app) {
    if (app.dsh === null) {
      return { skip: '没有找到 DeepSeek 运行时；设置 PICTOR_DSH_BIN 或先运行一次应用' }
    }

    const reply = '试运行拿到了这一轮的回答。'
    const model = await startStubModel({ reply, title: '试运行探测' })

    try {
      // The runtime is configured when it boots, so pointing the app at this
      // endpoint means making it the active provider and starting the runtime
      // again — the same two steps a user takes after editing a provider.
      const listed = await page.evaluate(
        async (baseUrl) =>
          window.pictor.saveProvider({
            name: 'e2e 试运行',
            baseUrl,
            protocol: 'openai-completions',
            modelId: 'stub-model',
            models: [{ id: 'stub-model' }],
            apiKey: 'e2e-key',
          }),
        model.baseUrl,
      )
      const added = listed.providers.find((provider) => provider.baseUrl === model.baseUrl)
      assert.ok(added !== undefined, 'the provider was saved')
      await page.evaluate((id) => window.pictor.activateProvider(id), added.id)

      await page.evaluate(() => window.pictor.harnessStop())
      const status = await page.evaluate((cwd) => window.pictor.harnessStart(cwd), app.workdir)
      assert.equal(status.state, 'ready', `the runtime booted: ${status.error ?? ''}`)

      // 设置 → 模型 → 试运行，the way a user reaches the check.
      await page.keyboard.press('Control+,')
      const sidebar = page.getByRole('navigation', { name: '设置分类' })
      await sidebar.getByRole('button', { name: '模型' }).click({ timeout: 15_000 })
      await page.getByRole('button', { name: '试运行', exact: true }).click({ timeout: 15_000 })

      const dialog = page.getByRole('dialog', { name: '试运行' })
      await dialog.getByLabel('试运行提示词').fill('说一句话')
      await dialog.getByRole('button', { name: '运行' }).click()

      await dialog.getByText('Agent 调用成功').waitFor({ timeout: 90_000 })
      await dialog.getByText(reply).waitFor({ timeout: 15_000 })
      // The event list is how the dialog shows the runtime's own vocabulary.
      const events = await dialog.getByText(/^事件：/).innerText()
      assert.match(events, /turn\/(start|end)/, `the probe reported events: ${events}`)

      await dialog.getByRole('button', { name: '关闭' }).click()

      // With the runtime down there is no second engine to fall back to: the
      // message is refused, and the endpoint is not called at all.
      await page.evaluate(() => window.pictor.harnessStop())
      const before = model.requests.length
      const session = await page.evaluate(() => window.pictor.createSession(null, 'e2e 拒绝降级'))
      const refusal = await page.evaluate(async (id) => {
        try {
          await window.pictor.sendChat(id, '说点什么')
          return null
        } catch (reason) {
          return reason instanceof Error ? reason.message : String(reason)
        }
      }, session.id)

      assert.match(refusal ?? '', /运行时/, 'the refusal names the runtime')
      assert.equal(model.requests.length, before, 'no other engine answered the message')

      // The specs share one window, so this one leaves it where it found it —
      // and waits for the home view to render before handing over.
      await page
        .getByRole('navigation', { name: '主导航' })
        .getByRole('button', { name: '首页' })
        .click()
      await page.getByRole('button', { name: '搜索会话' }).waitFor({ timeout: 15_000 })
    } finally {
      await model.close()
    }
  },
}
