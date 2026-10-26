import assert from 'node:assert/strict'

/**
 * A panel contributed by a plugin, opened the way a person opens one.
 *
 * `plugins/hello-panel` is mounted as a bundled example, so this spec is about the
 * promise the panel column makes: a plugin hands over a **description**, the window
 * draws it with its own blocks, and refresh means reading again. Nothing here stubs the
 * bridge — the click goes through IPC, the plugin's function runs in the main process,
 * and the answer comes back validated.
 */
export default {
  name: '插件面板',
  async run(page) {
    // The column is open by default on a wide window; a spec that collapsed it earlier
    // in the run must not decide whether this one can start.
    const opener = page.getByRole('button', { name: '展开右侧面板' })
    if ((await opener.count()) > 0) await opener.click()

    const row = page.getByRole('button', { name: /示例面板/ })
    await row.waitFor({ timeout: 30_000 })
    await row.click()

    // Blocks the plugin described, drawn by the renderer: a heading, an ordered list,
    // a key/value row it filled from its own context, a table and a code block.
    await page.getByText('内容是插件说的，画的是窗口').waitFor({ timeout: 20_000 })
    await page.getByText('九种块').waitFor({ timeout: 20_000 })
    await page.getByText('每行的格子数必须和列数一致').waitFor({ timeout: 20_000 })
    await page.getByText('和会话里同一套渲染').waitFor({ timeout: 20_000 })
    // The context a view is handed: its own plugin id, and a directory of its own to keep
    // files in when it needs more than one answer's worth of state.
    assert.equal(await page.getByText('pictor.example.hello-panel', { exact: true }).count(), 1)
    await page.getByText(/plugin-data\/pictor\.example\.hello-panel/).waitFor({ timeout: 20_000 })

    // The note is the plugin's own words about its data, so it is drawn under the blocks.
    const note = page.getByText(/视图只在打开和按刷新时读取/)
    await note.waitFor({ timeout: 20_000 })

    // Refresh reads again — the view counts its reads, so the change is visible.
    await page.getByRole('button', { name: '刷新' }).click()
    await page.getByText('第 2 次读取').first().waitFor({ timeout: 20_000 })

    // Going back restores the list: one level deep, and the same row is still there.
    await page.getByRole('button', { name: '返回面板列表' }).click()
    await row.waitFor({ timeout: 20_000 })
    assert.equal(
      await page.getByText('九种块').count(),
      0,
      'the view is gone once the column is back to its list',
    )
  },
}
