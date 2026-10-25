import assert from 'node:assert/strict'

/**
 * The kernel a conversation runs on, as the interface shows it.
 *
 * A conversation belongs to the kernel that started it, because the kernel owns
 * the transcript. Two kernels are registered in this build (dsh and Pi), so the
 * picker has a real choice to offer and must be drawn; what still has to hold is
 * the bookkeeping: every conversation names its kernel, switching kernels is a
 * branch that points back at the conversation it came from, and a conversation
 * written before kernels existed is filed under the one that shipped first.
 *
 * Nothing here boots Pi: a turn is a real model call on the user's own
 * credentials, which is not something a test run should spend.
 */
export default {
  name: '内核绑定',
  async run(page) {
    const kernels = await page.evaluate(() => window.pictor.listKernels())
    assert.ok(kernels.length >= 2, `two kernels are registered, got ${String(kernels.length)}`)

    const dsh = kernels.find((kernel) => kernel.id === 'dsh')
    assert.ok(dsh !== undefined, 'dsh is registered')
    assert.equal(dsh.default, true, 'dsh is the default kernel')
    const pi = kernels.find((kernel) => kernel.id === 'pi')
    assert.ok(pi !== undefined, 'Pi is registered as a second kernel')
    assert.equal(pi.default, false, 'Pi is not the default')
    // Availability is the driver's own answer about this machine, so a CI run
    // without Pi installed is a valid state rather than a failure.
    assert.equal(typeof pi.available, 'boolean', 'availability is reported')

    const created = await page.evaluate(() => window.pictor.createSession(null, 'e2e 内核绑定'))
    assert.equal(created.kernelId, 'dsh', 'a new conversation names its kernel')

    const stored = await page.evaluate(async (id) => {
      const snapshot = await window.pictor.getSnapshot()
      return snapshot.sessions.find((entry) => entry.id === id) ?? null
    }, created.id)
    assert.equal(stored?.kernelId, 'dsh', 'the kernel survives a read back')

    // Switching kernels is a branch: the new conversation names the new kernel and
    // points at the one it was branched from.
    const branch = await page.evaluate(
      (parent) => window.pictor.createSession(null, 'e2e 内核分支', 'pi', parent),
      created.id,
    )
    assert.equal(branch.kernelId, 'pi', 'the branch runs on the kernel that was picked')
    assert.equal(branch.parentId, created.id, 'the branch points back at its source')

    await page.reload()
    await page.waitForSelector('header', { timeout: 30_000 })

    // Two kernels is a choice, so the control is drawn.
    const triggers = page.locator('[aria-label^="内核："]')
    assert.equal(await triggers.count(), 1, 'the picker is drawn once, in the composer')

    // Selecting the branch shows the kernel that branch runs on, which is the
    // whole point of binding it to the conversation.
    await page.getByRole('button', { name: 'e2e 内核分支' }).first().click({ timeout: 15_000 })
    await page.locator('[aria-label="内核：Pi"]').waitFor({ timeout: 20_000 })

    // What each kernel can do travels with it, so the window can stop promising
    // things the kernel behind the conversation cannot deliver.
    const declared = await page.evaluate(() => window.pictor.listKernels())
    assert.deepEqual(declared.find((kernel) => kernel.id === 'pi')?.capabilities, {
      permission: false,
      model: false,
      skills: false,
      fork: false,
    })
    assert.deepEqual(declared.find((kernel) => kernel.id === 'dsh')?.capabilities, {
      permission: true,
      model: true,
      skills: true,
      fork: true,
    })

    // Pi decides its own sandbox, so its composer draws no switch. The row still
    // shows "工作区可写" without one on dsh, which is what makes this the kernel's
    // answer rather than a composer that failed to render.
    assert.equal(
      await page.locator('[aria-label^="会话权限："]').count(),
      0,
      'a kernel without a sandbox offers no sandbox picker',
    )

    await page.getByRole('button', { name: 'e2e 内核绑定' }).first().click({ timeout: 15_000 })
    await page.locator('[aria-label="内核：DeepSeek Harness"]').waitFor({ timeout: 20_000 })
    await page.locator('[aria-label^="会话权限："]').waitFor({ timeout: 20_000 })

    // The rail has one destination per kernel, in a fixed order.
    const rail = page.getByRole('navigation', { name: '主导航' })
    assert.deepEqual(
      await rail
        .locator('button')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label'))),
      ['首页', 'DSH', 'PI', '设置'],
    )

    // A kernel's page lists that kernel's conversations and nobody else's. Both
    // rows were created above, so each page must show exactly one of them.
    await rail.getByRole('button', { name: 'PI', exact: true }).click()
    await page.getByRole('button', { name: 'e2e 内核分支' }).first().waitFor({ timeout: 15_000 })
    assert.equal(
      await page.getByRole('button', { name: 'e2e 内核绑定' }).count(),
      0,
      'the Pi page does not list a dsh conversation',
    )
    // The page has already answered "which kernel", so it offers no picker.
    assert.equal(
      await page.locator('[aria-label^="内核："]').count(),
      0,
      'a scoped page draws no kernel picker',
    )

    await rail.getByRole('button', { name: 'DSH', exact: true }).click()
    await page.getByRole('button', { name: 'e2e 内核绑定' }).first().waitFor({ timeout: 15_000 })
    assert.equal(
      await page.getByRole('button', { name: 'e2e 内核分支' }).count(),
      0,
      'the DSH page does not list a Pi conversation',
    )

    // Home spans both, and is the only page that offers the choice.
    await rail.getByRole('button', { name: '首页' }).click()
    await page.getByRole('button', { name: 'e2e 内核分支' }).first().waitFor({ timeout: 15_000 })
    await page.getByRole('button', { name: 'e2e 内核绑定' }).first().waitFor({ timeout: 15_000 })
    await page.locator('[aria-label^="内核："]').first().waitFor({ timeout: 20_000 })
  },
}
