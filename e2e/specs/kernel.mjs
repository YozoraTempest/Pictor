import assert from 'node:assert/strict'

/**
 * The kernel a conversation runs on, as the interface shows it.
 *
 * One kernel is registered in this build, so the picker must not appear at all —
 * a control with a single option is furniture. What still has to hold is the
 * bookkeeping: every conversation names the kernel that executes it, and a
 * conversation written before kernels existed is filed under the one that shipped
 * first rather than left blank.
 */
export default {
  name: '内核绑定',
  async run(page) {
    const kernels = await page.evaluate(() => window.pictor.listKernels())
    assert.ok(kernels.length >= 1, 'at least one kernel is registered')

    const dsh = kernels.find((kernel) => kernel.id === 'dsh')
    assert.ok(dsh !== undefined, 'dsh is registered')
    assert.equal(dsh.default, true, 'dsh is the default kernel')

    const created = await page.evaluate(() => window.pictor.createSession(null, 'e2e 内核绑定'))
    assert.equal(created.kernelId, 'dsh', 'a new conversation names its kernel')

    const stored = await page.evaluate(async (id) => {
      const snapshot = await window.pictor.getSnapshot()
      return snapshot.sessions.find((entry) => entry.id === id) ?? null
    }, created.id)
    assert.equal(stored?.kernelId, 'dsh', 'the kernel survives a read back')

    await page.reload()
    await page.waitForSelector('header', { timeout: 30_000 })

    // With one kernel there is nothing to choose, so nothing is drawn.
    const pickers = await page.evaluate(
      () =>
        [...document.querySelectorAll('[aria-label]')].filter((node) =>
          (node.getAttribute('aria-label') ?? '').startsWith('内核：'),
        ).length,
    )
    assert.equal(pickers, 0, 'a single kernel means no picker')
  },
}
