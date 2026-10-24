import assert from 'node:assert/strict'

import { startStubModel } from '../stub-model.mjs'

/**
 * Changing the service must change what the next message uses.
 *
 * The route, the model and the key are read once when the runtime boots, so a
 * saved change used to sit there while conversations kept going to the previous
 * endpoint — with the settings page happily calling the new one 使用中. The spec
 * pins both halves of the fix: it applies on the next message, and a turn that is
 * already streaming is never cut in half to make that happen.
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export default {
  name: '切换服务',
  async run(page, app) {
    if (app.dsh === null) {
      return { skip: '没有找到 DeepSeek 运行时；设置 PICTOR_DSH_BIN 或先运行一次应用' }
    }

    // A answers slowly enough that a switch can land while its turn is running.
    const a = await startStubModel({
      reply: 'A 端点给的回答。',
      delayMs: 2_500,
      title: 'e2e 切换服务',
    })
    const b = await startStubModel({ reply: 'B 端点给的回答。' })

    /** Save a provider and make it the one conversations use. */
    const activate = async (baseUrl, name) => {
      const listed = await page.evaluate(async (input) => window.pictor.saveProvider(input), {
        name,
        baseUrl,
        protocol: 'openai-completions',
        modelId: 'stub-model',
        models: [{ id: 'stub-model' }],
        // A key is an opaque token; a spec must not hand the runtime whitespace.
        apiKey: 'e2e-key',
      })
      const saved = listed.providers.find((provider) => provider.baseUrl === baseUrl)
      assert.ok(saved !== undefined, `the ${name} provider was saved`)
      await page.evaluate((id) => window.pictor.activateProvider(id), saved.id)
    }

    /** The transcript as the main process projects it, newest page first. */
    const transcript = (sessionId) =>
      page.evaluate((id) => window.pictor.chatHistory(`harness:${id}`, 50, 0), sessionId)

    const waitForReply = async (sessionId, needle) => {
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const history = await transcript(sessionId)
        if (history.messages.some((message) => message.text.includes(needle))) return
        await sleep(250)
      }
      throw new Error(`the transcript never contained: ${needle}`)
    }

    try {
      await activate(a.baseUrl, 'e2e A')
      await page.evaluate(() => window.pictor.harnessStop())
      const booted = await page.evaluate((cwd) => window.pictor.harnessStart(cwd), app.workdir)
      assert.equal(booted.state, 'ready', `the runtime booted: ${booted.error ?? ''}`)

      const session = await page.evaluate(() => window.pictor.createSession(null, 'e2e 切换服务'))

      // 1. The runtime boots with A, and A answers.
      await page.evaluate(([id, text]) => window.pictor.sendChat(id, text), [session.id, '第一条'])
      await waitForReply(session.id, 'A 端点给的回答。')
      const afterA = a.requests.length
      assert.ok(afterA > 0, 'A received the first turn')

      // 2. Switching while idle: no manual restart, the next message goes to B.
      await activate(b.baseUrl, 'e2e B')
      await page.evaluate(([id, text]) => window.pictor.sendChat(id, text), [session.id, '第二条'])
      await waitForReply(session.id, 'B 端点给的回答。')
      assert.equal(a.requests.length, afterA, 'A received nothing after the switch')

      // 3. Switching while a turn is streaming: the answer in flight completes,
      //    and the change lands before the next message.
      await activate(a.baseUrl, 'e2e A')
      const beforeDelayed = a.requests.length
      await page.evaluate(([id, text]) => window.pictor.sendChat(id, text), [session.id, '第三条'])
      // A takes ~2.5 s to answer; the switch below happens inside that window.
      await sleep(400)
      await activate(b.baseUrl, 'e2e B')

      await waitForReply(session.id, 'A 端点给的回答。')
      assert.ok(a.requests.length > beforeDelayed, 'the running turn still finished on A')

      await page.evaluate(([id, text]) => window.pictor.sendChat(id, text), [session.id, '第四条'])
      await waitForReply(session.id, 'B 端点给的回答。')

      // 4. The composer's own picker: one click switches service *and* model,
      //    which is what a reader picking a row there means.
      await page.reload()
      await page.waitForSelector('header', { timeout: 30_000 })
      await page.getByRole('button', { name: 'e2e 切换服务' }).first().click({ timeout: 15_000 })
      await page.getByRole('button', { name: '选择模型' }).click({ timeout: 15_000 })

      const picker = page.getByRole('dialog', { name: '选择模型' })
      await picker.waitFor({ timeout: 10_000 })
      // The shortcuts page has no search box; the full list is one level deeper,
      // which is where a reader who knows what they want goes.
      await picker.getByRole('button', { name: '所有模型' }).click({ timeout: 10_000 })
      await picker.getByLabel('搜索模型').fill('stub-model')
      // Both services offer `stub-model`; the row names the service it belongs to.
      const beforePicker = b.requests.length
      await picker.getByRole('button', { name: /e2e A/ }).first().click({ timeout: 15_000 })

      // Choosing restarts the runtime on the new service; a message sent mid-boot
      // would be refused, so wait for it like the window does.
      await page.evaluate(async () => {
        for (let attempt = 0; attempt < 120; attempt += 1) {
          const status = await window.pictor.harnessStatus()
          if (status.state === 'ready') return
          await new Promise((resolve) => setTimeout(resolve, 250))
        }
        throw new Error('the runtime never came back after the switch')
      })

      await page.getByLabel('消息输入').fill('从选择器切换')
      await page.getByLabel('消息输入').press('Enter')
      await page.getByText('A 端点给的回答。').first().waitFor({ timeout: 60_000 })
      assert.equal(b.requests.length, beforePicker, 'the other service received nothing')
    } finally {
      await a.close()
      await b.close()
    }
  },
}
