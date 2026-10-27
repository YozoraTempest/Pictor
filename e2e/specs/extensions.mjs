import assert from 'node:assert/strict'

/**
 * Everything that can be added to the app, on one page.
 *
 * These three used to be settings pages — one under 通用, two under 通用 › 智能体 — which
 * is where you look for a preference, not for something you install. The spec is about
 * the shape that replaced it: one rail entry above settings, three tabs, no third level,
 * and nothing left behind in the settings tree.
 */
export default {
  name: '拓展面板',
  async run(page) {
    await page.locator('nav[aria-label="主导航"] button[aria-label="拓展"]').click()

    // Named once: the page's own heading. The title bar stays quiet for this view.
    await page.getByRole('heading', { name: '拓展' }).waitFor({ timeout: 20_000 })

    const tabs = page.getByRole('tab')
    assert.deepEqual(await tabs.allInnerTexts(), ['插件', '技能', 'MCP'])

    // The plugins tab is the one it opens on, and it is the real panel: the two ways to
    // install something are there without going through settings first.
    await page.getByRole('button', { name: '从目录安装' }).waitFor({ timeout: 20_000 })
    assert.equal(
      await page.getByRole('tab', { name: '插件' }).getAttribute('aria-selected'),
      'true',
    )

    // The skills tab answers with or without a conversation open — the panel reads
    // Pictor's own root when there is none — so the assertion is the控件, not the copy.
    await page.getByRole('tab', { name: '技能' }).click()
    await page.getByRole('button', { name: '刷新技能列表' }).waitFor({ timeout: 20_000 })

    await page.getByRole('tab', { name: 'MCP' }).click()
    await page.getByRole('button', { name: '添加服务器' }).waitFor({ timeout: 20_000 })

    // And the settings tree no longer offers them: the same thing in two places would be
    // two places to keep in step.
    await page.locator('nav[aria-label="主导航"] button[aria-label="设置"]').click()
    await page.getByRole('button', { name: '通用' }).click()
    await page.locator('nav[aria-label="设置分类"]').waitFor({ timeout: 20_000 })
    const rows = (await page.locator('nav[aria-label="设置分类"] button').allInnerTexts()).map(
      (text) => text.trim(),
    )
    for (const gone of ['插件', '技能', 'MCP']) {
      assert.equal(rows.includes(gone), false, `${gone} 还在设置里`)
    }
  },
}
