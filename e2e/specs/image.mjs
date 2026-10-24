import assert from 'node:assert/strict'

import { startStubModel } from '../stub-model.mjs'

/**
 * A pasted image has to reach the model, not just the composer.
 *
 * The interesting part is the seam: the window turns clipboard bytes into a
 * thumbnail, main validates them into content parts, and the runtime sends them
 * as an image part in the request. The stub records whether the last request
 * carried one, which is the only place that can prove the round trip.
 */
export default {
  name: '图片输入',
  async run(page, app) {
    if (app.dsh === null) {
      return { skip: '没有找到 DeepSeek 运行时；设置 PICTOR_DSH_BIN 或先运行一次应用' }
    }

    const reply = '看到这张图了。'
    const model = await startStubModel({ reply })

    /** Dispatch a real paste on the composer, the way a clipboard delivers it. */
    const paste = (kind) =>
      page.evaluate((what) => {
        const bytes =
          what === 'image'
            ? Uint8Array.from(
                atob(
                  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
                ),
                (character) => character.charCodeAt(0),
              )
            : new TextEncoder().encode('plain text')
        const file = new File([bytes], what === 'image' ? 'dot.png' : 'note.txt', {
          type: what === 'image' ? 'image/png' : 'text/plain',
        })
        const data = new DataTransfer()
        data.items.add(file)
        const field = document.querySelector('textarea[aria-label="消息输入"]')
        field?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }))
      }, kind)

    try {
      const listed = await page.evaluate(
        (baseUrl) =>
          window.pictor.saveProvider({
            name: 'e2e 图片',
            baseUrl,
            protocol: 'openai-completions',
            modelId: 'stub-model',
            // The runtime refuses images for a model that never declared them, so
            // the service has to say it accepts them — as a real one would.
            models: [
              {
                id: 'stub-model',
                name: null,
                reasoning: null,
                input: ['text', 'image'],
                contextWindow: null,
                maxTokens: null,
              },
            ],
            apiKey: 'e2e-key',
          }),
        model.baseUrl,
      )
      const provider = listed.providers.find((entry) => entry.baseUrl === model.baseUrl)
      assert.ok(provider !== undefined, 'the provider was saved')
      await page.evaluate((id) => window.pictor.activateProvider(id), provider.id)

      await page.evaluate(() => window.pictor.harnessStop())
      const booted = await page.evaluate((cwd) => window.pictor.harnessStart(cwd), app.workdir)
      assert.equal(booted.state, 'ready', `the runtime booted: ${booted.error ?? ''}`)

      await page.evaluate(() => window.pictor.createSession(null, 'e2e 图片'))
      await page.reload()
      await page.waitForSelector('header', { timeout: 30_000 })
      await page.getByRole('button', { name: 'e2e 图片' }).first().click({ timeout: 15_000 })
      await page.getByLabel('消息输入').waitFor({ timeout: 15_000 })

      // 1. A pasted image becomes an attachment the reader can remove.
      await paste('image')
      await page.getByRole('button', { name: '移除图片' }).first().waitFor({ timeout: 10_000 })
      assert.equal(
        await page.locator('img[alt="dot.png"]').count(),
        1,
        'the composer previews the image',
      )

      // 2. Something that is not an image is not attached at all.
      await paste('text')
      await page.waitForTimeout(300)
      assert.equal(
        await page.getByRole('button', { name: '移除图片' }).count(),
        1,
        'a text file is not an attachment',
      )

      // 3. Sending carries it: the request has an image part, and the bubble shows it.
      await page.getByLabel('消息输入').fill('看看这张图')
      await page.getByLabel('消息输入').press('Enter')
      await page.getByText(reply).first().waitFor({ timeout: 60_000 })

      assert.ok(
        model.calls.some((call) => call.hasImage),
        `the runtime sent an image part: ${JSON.stringify(model.calls)}`,
      )
      assert.equal(
        await page.getByRole('button', { name: '移除图片' }).count(),
        0,
        'the composer let go of the attachment once it was sent',
      )
      assert.equal(
        await page.locator('img[alt="dot.png"]').count(),
        1,
        'the conversation shows the image that was sent',
      )
    } finally {
      await model.close()
    }
  },
}
