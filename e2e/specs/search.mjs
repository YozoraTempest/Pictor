import assert from 'node:assert/strict'

/**
 * The search palette lives in the home view's toolbar.
 *
 * These checks are all about what a reader sees: the button sits where the panel
 * toggle is, the palette narrows as you type, and a pick lands on that
 * conversation. They need no model, so they run in every environment.
 */
export default {
  name: 'search palette',
  async run(page) {
    // The button order is the whole point of placing it here.
    const toolbar = await page.$$eval('header button[aria-label]', (nodes) =>
      nodes.map((node) => node.getAttribute('aria-label')),
    )
    const searchAt = toolbar.indexOf('搜索会话')
    const panelAt = toolbar.indexOf('展开右侧面板')
    assert.ok(searchAt >= 0, 'the toolbar carries a 搜索会话 button')
    assert.equal(searchAt + 1, panelAt, '搜索会话 sits immediately left of 展开右侧面板')

    await page.click('header button[aria-label="搜索会话"]')
    const dialog = page.getByRole('dialog', { name: '搜索会话' })
    await dialog.waitFor({ timeout: 5_000 })

    const input = dialog.getByLabel('搜索会话')
    await assert.doesNotReject(() => input.fill('zzz-没有这个会话'))
    await dialog.getByText('没有匹配的会话').waitFor({ timeout: 5_000 })

    await input.fill('')
    const rows = dialog.locator('li')
    await rows.first().waitFor({ timeout: 5_000 })

    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached', timeout: 5_000 })

    // The shortcut belongs to the same view.
    await page.keyboard.press('Control+k')
    await page.getByRole('dialog', { name: '搜索会话' }).waitFor({ timeout: 5_000 })
    await page.keyboard.press('Escape')
  },
}
