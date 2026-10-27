import assert from 'node:assert/strict'

/**
 * The one block a person can press, all the way through.
 *
 * A `button` block carries an action id and nothing else; pressing it sends that id over
 * IPC, the plugin's `onAction` runs in the main process beside the plugin, and a fresh
 * description comes back to replace what was drawn. The window never runs plugin code, so
 * what this spec checks is the round trip: the id arrives, the plugin's own counter moved,
 * and the new description is on screen while the old one is gone.
 */
export default {
  name: '插件动作',
  async run(page) {
    // Start from home, and from an expanded column: earlier specs may have left the app on
    // another page or with the column collapsed, and neither is this spec's subject.
    await page
      .getByRole('navigation', { name: '主导航' })
      .getByRole('button', { name: '首页' })
      .click()
    const opener = page.getByRole('button', { name: '展开右侧面板' })
    if ((await opener.count()) > 0) await opener.click()

    const row = page.getByRole('button', { name: /示例面板/ })
    await row.waitFor({ timeout: 30_000 })
    // A narrow window keeps the column closed, and a row behind a zero-width track cannot
    // be clicked with a pointer. Opening a panel is itself what expands the column, so the
    // same handler runs either way: click for real when there is room, dispatch when not.
    await row.click({ timeout: 3_000 }).catch(() => row.evaluate((element) => element.click()))

    // The plugin counts its own presses, and other specs may have run first, so the count
    // is read off the caption rather than assumed.
    const before = page.getByRole('button', { name: /^按一下（已按 \d+ 次）$/ })
    await before.waitFor({ timeout: 20_000 })
    const first = Number((await before.textContent())?.match(/已按 (\d+) 次/)?.[1])

    await before.click()

    // The answer is a whole new description: a badge, a button that names the new count, and
    // a line only this handler produces. The ten-block view it replaced is gone with it.
    const after = page.getByRole('button', { name: `再按一下（已按 ${String(first + 1)} 次）` })
    await after.waitFor({ timeout: 20_000 })
    await page
      .getByText(`已按 ${String(first + 1)} 次`, { exact: true })
      .waitFor({ timeout: 20_000 })
    await page.getByText('这一块是点击之后重新描述出来的').waitFor({ timeout: 20_000 })
    assert.equal(
      await page.getByText('十种块').count(),
      0,
      'the description the press replaced is gone, not stacked under the new one',
    )

    // Pressing again goes through the same channel: the plugin's state keeps counting, which
    // is what proves the press reaches the plugin rather than a cached answer.
    await after.click()
    await page
      .getByRole('button', { name: `再按一下（已按 ${String(first + 2)} 次）` })
      .waitFor({ timeout: 20_000 })

    // Back to the list, so the next spec starts from the column's default state.
    await page.getByRole('button', { name: '返回面板列表' }).click()
    await row.waitFor({ timeout: 20_000 })
  },
}
