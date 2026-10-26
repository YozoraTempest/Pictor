import assert from 'node:assert/strict'

import { startStubModel } from '../stub-model.mjs'

/**
 * The model asks, the reader answers, the turn continues.
 *
 * `ask_user_question` waits on a waterfall event rather than inside the turn: if
 * nobody answers it, the tool call fails with "no answerer". This spec drives the
 * whole exchange on a local stub, so what it proves is the channel — the card
 * appears, the answer reaches the runtime, and the model gets that answer back as
 * its tool result.
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export default {
  name: '模型提问',
  async run(page, app) {
    if (app.dsh === null) {
      return { skip: '没有找到 DeepSeek 运行时；设置 PICTOR_DSH_BIN 或先运行一次应用' }
    }

    const answer = '蓝色'
    const model = await startStubModel({
      toolCalls: [
        {
          name: 'ask_user_question',
          arguments: {
            questions: [
              {
                id: 'color',
                header: '选个颜色',
                question: '你要哪一种蓝色？',
                options: [{ label: answer }, { label: '红色' }],
              },
            ],
          },
        },
      ],
      reply: '收到，用蓝色。',
    })

    try {
      const listed = await page.evaluate((input) => window.pictor.saveProvider(input), {
        name: 'e2e 提问',
        baseUrl: model.baseUrl,
        protocol: 'openai-completions',
        modelId: 'stub-model',
        models: [{ id: 'stub-model' }],
        apiKey: 'e2e-key',
      })
      const saved = listed.providers.find((provider) => provider.baseUrl === model.baseUrl)
      assert.ok(saved !== undefined, 'the provider was saved')
      await page.evaluate((id) => window.pictor.activateProvider(id), saved.id)
      await page.evaluate(() => window.pictor.harnessStop())
      const booted = await page.evaluate((cwd) => window.pictor.harnessStart(cwd), app.workdir)
      assert.equal(booted.state, 'ready', `the runtime booted: ${booted.error ?? ''}`)

      await page.evaluate(() => window.pictor.createSession(null, 'e2e 提问'))
      await page.reload()
      await page.waitForSelector('header', { timeout: 30_000 })
      await page.getByRole('button', { name: 'e2e 提问' }).first().click({ timeout: 15_000 })
      await page.getByLabel('消息输入').fill('帮我问一下')
      await page.getByLabel('消息输入').press('Enter')

      // The card is the only visible sign that the turn is held on a question.
      const card = page.getByText('在等你回答')
      for (let attempt = 0; attempt < 120; attempt += 1) {
        if ((await card.count()) > 0) break
        await sleep(250)
      }
      assert.equal(await card.count(), 1, 'the question card appeared')

      const body = await page.getByText('在等你回答').first().locator('xpath=../../..').innerText()
      assert.match(body, /你要哪一种蓝色/, 'the card shows what the model asked')
      assert.match(body, /选个颜色/, 'and the header it sent')

      await page.getByRole('button', { name: answer, exact: true }).click()
      await page.getByRole('button', { name: '回答', exact: true }).click()

      // The model's next request carries the answer as the tool result. That is the
      // only place the whole loop can be checked: the runtime turns the waterfall
      // answer into the tool message the model reads next.
      await page.getByText('收到，用蓝色。').first().waitFor({ timeout: 60_000 })
      const forwarded = model.calls.at(-1) ?? null
      assert.ok(forwarded !== null, 'the model was called again after the answer')
      assert.ok(forwarded.roles.includes('tool'), 'the answer arrived as a tool message')
      assert.match(forwarded.toolText, new RegExp(answer), 'the answer reached the model')
      assert.equal(await page.getByText('在等你回答').count(), 0, 'the card closes on an answer')
    } finally {
      await model.close()
    }
  },
}
