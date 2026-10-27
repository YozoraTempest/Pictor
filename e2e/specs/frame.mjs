import assert from 'node:assert/strict'

import { openKernel } from '../harness.mjs'

/**
 * A plugin's own front end, in a box.
 *
 * This is the second payload a view can have: instead of a description the window draws,
 * the plugin ships a bundle and the window runs it. What the spec has to prove is that the
 * box is a box — the bundle loads with its own styles, its clicks reach the plugin in the
 * main process and come back, and nothing inside it can reach the network.
 *
 * The frame is talked to through `frameLocator`, which is the same boundary a person has:
 * a document the app does not share an origin with.
 */
export default {
  name: '插件前端',
  async run(page) {
    // Start from home: the panel column belongs to the shell, but a spec that ran before
    // this one may have left the app on the extensions page.
    await openKernel(page, 'DeepSeek Harness')

    const opener = page.getByRole('button', { name: '展开右侧面板' })
    if ((await opener.count()) > 0) await opener.click()

    const row = page.getByRole('button', { name: /示例画板/ })
    await row.waitFor({ timeout: 30_000 })
    // A narrow window keeps the column closed, and a row behind a zero-width track cannot
    // be clicked with a pointer. Opening a panel is itself what expands the column, so the
    // same handler runs either way: click for real when there is room, dispatch when not.
    await row.click({ timeout: 3_000 }).catch(() => row.evaluate((element) => element.click()))

    const frame = page.frameLocator('iframe')
    await frame.getByRole('heading', { name: '这个界面是插件画的' }).waitFor({ timeout: 30_000 })

    // The column animates open (300ms). A click into a frame that is still moving lands
    // where the frame used to be — the coordinates are read once, across a border — so the
    // frame is waited for rather than assumed settled.
    let settled = null
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const box = await page.locator('iframe').boundingBox()
      if (box !== null && settled !== null && box.x === settled.x && box.width === settled.width) {
        break
      }
      settled = box
      await page.waitForTimeout(100)
    }

    // The sandbox is the guarantee, so it is asserted as a value: scripts only. With
    // `allow-same-origin` the bundle would share this document's origin and could read the
    // app, which is the one thing this whole design exists to prevent.
    assert.equal(await page.locator('iframe').getAttribute('sandbox'), 'allow-scripts')

    // The window tells the frame which conversation it landed in.
    await frame.getByText(/^会话：/).waitFor({ timeout: 20_000 })

    // A click inside the frame becomes a message, the plugin answers from the main process,
    // and the answer is drawn by the plugin's own code. The count comes from the caption so
    // a rerun does not depend on starting at one.
    // The caption before an answer ("还没有和插件说过话") also contains 「插件说」, so the
    // count the bundle writes onto the paragraph is the signal — text matching would pass
    // on a frame that never answered at all.
    const said = frame.locator('.said[data-count]')
    const press = frame.getByRole('button', { name: '按一下' })
    await press.click()
    await said.waitFor({ timeout: 20_000 })
    const first = Number(await said.getAttribute('data-count'))

    await press.click()
    await frame.locator(`.said[data-count="${String(first + 1)}"]`).waitFor({ timeout: 20_000 })

    // The bundle is honouring its own stylesheet, which is a second file served from the
    // same mount — a front end is more than one module.
    const accent = await frame
      .locator('.press')
      .evaluate((element) => getComputedStyle(element).borderColor)
    assert.equal(accent, 'rgb(110, 168, 254)', 'the bundle loaded its own stylesheet')

    // No network: the frame may draw, and may ask the plugin, and that is all.
    const blocked = await frame.locator('body').evaluate(async () => {
      try {
        await fetch('http://example.com/')
        return false
      } catch {
        return true
      }
    })
    assert.equal(blocked, true, 'a frame cannot reach the network')

    await page.getByRole('button', { name: '返回面板列表' }).click()
    await row.waitFor({ timeout: 20_000 })
  },
}
