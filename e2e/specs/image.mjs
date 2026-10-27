import assert from 'node:assert/strict'

import { startStubModel } from '../stub-model.mjs'
import { openKernel } from '../harness.mjs'

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
      // The service is configured the way a person would: the image capability is
      // a switch in the dialog, because the runtime refuses images for a model
      // that never declared them.
      await page.keyboard.press('Control+,')
      await page
        .locator('nav[aria-label="主导航"] button[aria-label="DeepSeek Harness 设置"]')
        .click()
      const sidebar = page.getByRole('navigation', { name: '设置分类' })
      await sidebar.getByRole('button', { name: '模型' }).click({ timeout: 15_000 })
      await page.getByRole('button', { name: '添加服务' }).click({ timeout: 15_000 })

      const editor = page.getByRole('dialog', { name: '添加服务' })
      await editor.getByLabel('服务名称').fill('e2e 图片')
      await editor.getByLabel('Base URL').fill(model.baseUrl)
      await editor.getByLabel('模型 ID').fill('stub-model')
      await editor.getByLabel('API Key').fill('e2e-key')

      const imageSwitch = editor.getByRole('switch', { name: '图片输入' })
      assert.equal(await imageSwitch.getAttribute('aria-checked'), 'false', 'text-only by default')
      await imageSwitch.click()
      await editor.getByRole('button', { name: '添加' }).click()
      await editor.waitFor({ state: 'detached', timeout: 15_000 })

      // The first service of a fresh profile is already the active one, so the row
      // may offer 「使用中」 instead of 「使用」.
      await page
        .getByRole('button', { name: /(使用 e2e 图片|e2e 图片 使用中)/ })
        .first()
        .click({ timeout: 15_000 })

      // Reopening shows what was saved; the capability is a stored fact, not a
      // one-off in the form.
      await page.getByRole('button', { name: '编辑 e2e 图片' }).click({ timeout: 15_000 })
      const reopened = page.getByRole('dialog', { name: '编辑「e2e 图片」' })
      await reopened.waitFor({ timeout: 10_000 })
      assert.equal(
        await reopened.getByRole('switch', { name: '图片输入' }).getAttribute('aria-checked'),
        'true',
        'the saved capability survives a reopen',
      )
      await page.keyboard.press('Escape')
      await reopened.waitFor({ state: 'detached', timeout: 10_000 })

      // Saving the service and making it active already restarted the runtime on
      // it; stopping it again here would boot a new one while the old is still
      // exiting, and the runtime's profile is locked until it does.
      await page.evaluate((cwd) => window.pictor.harnessStart(cwd), app.workdir)
      const status = await page.evaluate(() => window.pictor.harnessStatus())
      assert.equal(status.state, 'ready', `the runtime is up: ${status.error ?? ''}`)

      await page.evaluate(() => window.pictor.createSession(null, 'e2e 图片'))
      await page.reload()
      await page.waitForSelector('header', { timeout: 30_000 })
      await openKernel(page, 'DeepSeek Harness')
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
