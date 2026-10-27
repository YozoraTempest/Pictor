import assert from 'node:assert/strict'

import { openKernel } from '../harness.mjs'

/** Polls until `check` holds; the sidebar redraws after a page switch. */
async function eventually(check, message, timeout = 15_000) {
  const deadline = Date.now() + timeout
  for (;;) {
    if (await check()) return
    if (Date.now() > deadline) assert.fail(message)
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
}

/**
 * The ars a conversation runs on, as the interface shows it.
 *
 * A conversation belongs to the ars that started it, because that software owns the
 * transcript. Two are mounted here: dsh, which ships with the app, and 回声（示例）, which
 * the harness installs as a directory — so the bookkeeping is exercised between a
 * built-in and a third-party one rather than between two halves of the same build.
 *
 * Switching ars is a branch: the new conversation names the ars that was picked and
 * points back at the one it came from. Nothing here spends a model call.
 */
export default {
  name: '内核绑定',
  async run(page) {
    const kernels = await page.evaluate(() => window.pictor.listKernels())
    assert.equal(kernels.length, 2, `装了两个 ars，实际 ${String(kernels.length)} 个`)

    const dsh = kernels.find((kernel) => kernel.id === 'dsh')
    assert.ok(dsh !== undefined, 'dsh 是自带的那个')
    assert.equal(dsh.default, true, 'dsh 是默认 ars')
    assert.equal(typeof dsh.icon, 'string', 'ars 自己说用什么图标')
    // Availability is the driver's own answer about this machine, so an environment
    // without it installed is a valid state rather than a failure.
    assert.equal(typeof dsh.available, 'boolean', '可用与否由驱动回答')

    const fake = kernels.find((kernel) => kernel.id === 'fake')
    assert.ok(fake !== undefined, '装进目录的那个 ars 也在')
    assert.equal(fake.default, false, '装进来的不抢默认')
    assert.equal(fake.label, '回声（示例）')

    const created = await page.evaluate(() => window.pictor.createSession(null, 'e2e 内核绑定'))
    assert.equal(created.kernelId, 'dsh', '新会话记下自己的 ars')

    const stored = await page.evaluate(async (id) => {
      const snapshot = await window.pictor.getSnapshot()
      return snapshot.sessions.find((entry) => entry.id === id) ?? null
    }, created.id)
    assert.equal(stored?.kernelId, 'dsh', '这个归属读回来还在')

    // What the ars can do travels with it, so the window can stop promising things the
    // software behind the conversation cannot deliver. These seven flags are the whole
    // declaration: each one a control or a page that is drawn or withheld.
    assert.deepEqual(dsh.capabilities, {
      permission: true,
      // dsh's own policy decides when it asks; a second switch would be a lie.
      approval: false,
      model: true,
      skills: true,
      fork: true,
      commands: true,
      // `job/list` for the roster, `job/kill` for the stop.
      jobs: true,
    })

    // The row exists on the page only after the window has read the snapshot again, and
    // nothing pushes that from here: creating a conversation over IPC does not touch the
    // renderer's store, so this opens the window it is about to look at.
    await page.reload()
    await page.waitForSelector('header', { timeout: 30_000 })
    await openKernel(page, 'DeepSeek Harness')
    await page.getByRole('button', { name: 'e2e 内核绑定' }).first().click({ timeout: 15_000 })

    // The composer's row is the ars's own answers, not a fixed toolbar: the sandbox switch
    // is there because dsh can hold a call, and the approval switch — which belongs to
    // software that cannot decide for itself — is not.
    await page.locator('[aria-label^="会话权限："]').waitFor({ timeout: 20_000 })
    assert.equal(await page.locator('[aria-label^="会话审批："]').count(), 0)

    // dsh runs Pictor's models, so the ars-specific picker — the one for software that
    // keeps its own catalogue — is not drawn. Pictor's own picker needs a configured
    // provider and an e2e profile has none, so its absence here would say nothing; the
    // claim under test is which of the two belongs to this ars.
    assert.equal(await page.locator('[aria-label="选择内核模型"]').count(), 0)

    // Two ars is a choice, and the picker names the one this conversation is on.
    const trigger = page.locator('[aria-label="内核：DeepSeek Harness"]')
    await trigger.waitFor({ timeout: 20_000 })
    await trigger.click()

    // Picking the other one branches rather than rewriting: the row keeps its history and
    // the new conversation is named after the ars it now runs on.
    await page.getByRole('dialog', { name: '选择内核' }).waitFor({ timeout: 15_000 })
    await page
      .getByRole('dialog', { name: '选择内核' })
      .getByRole('button', { name: /回声（示例）/ })
      .click()

    const branch = `e2e 内核绑定 · 回声（示例）`
    await openKernel(page, '回声（示例）')
    await page.getByRole('button', { name: branch }).first().click({ timeout: 15_000 })

    const branched = await page.evaluate(async (title) => {
      const snapshot = await window.pictor.getSnapshot()
      return snapshot.sessions.find((entry) => entry.title === title) ?? null
    }, branch)
    assert.equal(branched?.kernelId, 'fake', '分支跑在被选中的 ars 上')
    assert.equal(branched?.parentId, created.id, '分支指回它来的那个会话')

    // The branch's own ars decides the row: it declared no sandbox and no say in when to
    // ask, so neither switch is drawn — which is what makes the row above dsh's answer
    // rather than a toolbar that failed to render.
    await page.locator('[aria-label="内核：回声（示例）"]').waitFor({ timeout: 20_000 })
    assert.equal(await page.locator('[aria-label^="会话权限："]').count(), 0)
    assert.equal(await page.locator('[aria-label^="会话审批："]').count(), 0)

    // One destination per mounted ars — its page, then its settings — in the order the
    // host mounted them, derived from `kernels.list()`. That derivation is the point:
    // installing another one adds two entries without an edit in this file.
    const rail = page.getByRole('navigation', { name: '主导航' })
    assert.deepEqual(
      await rail
        .locator('button')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label'))),
      // 拓展 sits above settings: what can be added, then what can be configured.
      [
        '首页',
        ...kernels.flatMap((kernel) => [kernel.label, `${kernel.label} 设置`]),
        '拓展',
        '设置',
      ],
    )

    // A page lists that ars's conversations and nobody else's: each row was created above,
    // so each page must show exactly one of them.
    await eventually(
      async () =>
        (await page.getByRole('button', { name: 'e2e 内核绑定', exact: true }).count()) === 0,
      '回声（示例）的页面不列 dsh 的会话',
    )
    await rail.getByRole('button', { name: 'DeepSeek Harness', exact: true }).click()
    await page.getByRole('button', { name: 'e2e 内核绑定', exact: true }).first().waitFor({
      timeout: 15_000,
    })
    assert.equal(
      await page.getByRole('button', { name: branch }).count(),
      0,
      'dsh 的页面不列回声（示例）的会话',
    )

    // A heading with nothing under it reads as a failed load, so a page draws the sections
    // that hold something of its own ars. 置顶 is the clean case: one pinned dsh
    // conversation gives the section a body there and none on the other page.
    //
    // Section titles are read from their own nodes: every tooltip in the app lives in the
    // body with `opacity-0`, so a text search would match those instead.
    const headings = () => page.locator('span.uppercase').allTextContents()

    await page.evaluate((id) => window.pictor.setSessionPinned(id, true), created.id)
    await page.reload()
    await page.waitForSelector('header', { timeout: 30_000 })

    await openKernel(page, '回声（示例）')
    await page.getByRole('button', { name: branch }).first().waitFor({ timeout: 15_000 })
    await eventually(async () => !(await headings()).includes('置顶'), '没有置顶会话就不画这一节')

    await rail.getByRole('button', { name: 'DeepSeek Harness', exact: true }).click()
    await page.getByRole('button', { name: 'e2e 内核绑定', exact: true }).first().waitFor({
      timeout: 15_000,
    })
    await eventually(
      async () => (await headings()).includes('置顶'),
      '有置顶会话的这一页上有这一节',
    )
    await page.evaluate((id) => window.pictor.setSessionPinned(id, false), created.id)

    // Home is not an ars: it runs nothing, so it holds no list and draws no composer. A
    // page that offered to start a conversation would have to ask which ars runs it.
    await rail.getByRole('button', { name: '首页' }).click()
    await page
      .locator('nav[aria-label="主导航"] button[aria-current="page"][aria-label="首页"]')
      .waitFor({ timeout: 15_000 })
    assert.equal(
      await page.getByRole('button', { name: 'e2e 内核绑定', exact: true }).count(),
      0,
      '首页不列任何 ars 的会话',
    )
    assert.equal(await page.getByRole('button', { name: branch }).count(), 0, '另一个也一样')
    assert.equal(await page.locator('[aria-label="选择模型"]').count(), 0, '首页没有输入框')
    assert.equal(await page.locator('[aria-label^="内核："]').count(), 0, '也就不问哪个 ars')
  },
}
