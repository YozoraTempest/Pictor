import assert from 'node:assert/strict'

import { openKernel } from '../harness.mjs'

/**
 * A kernel that was installed rather than compiled in.
 *
 * The harness drops `plugins/fake-kernel` into the profile before launch, so this
 * spec is about the promise the container makes: adding a kernel is a directory, and
 * a kernel that appears there answers the same windows as the built-in ones. It is
 * deliberately the cheapest kernel that can do that — it echoes — because what is
 * under test is the wiring, not a model.
 */
export default {
  name: '内核插件',
  async run(page) {
    const kernels = await page.evaluate(() => window.pictor.listKernels())
    const fake = kernels.find((kernel) => kernel.id === 'fake')
    assert.ok(
      fake !== undefined,
      `an installed kernel is mounted, got ${kernels.map((k) => k.id).join(',')}`,
    )
    assert.equal(fake.label, '回声（示例）', 'the kernel names itself')
    assert.equal(fake.default, false, 'dsh stays the default kernel')
    assert.equal(fake.available, true, 'an installed kernel reports itself available')
    // Nothing it declares it cannot honour: the host refuses a kernel that claims a
    // capability with no method behind it, so reaching here means the check passed.
    assert.deepEqual(fake.capabilities, {
      permission: false,
      approval: false,
      model: false,
      skills: false,
      fork: false,
    })

    const created = await page.evaluate(() =>
      window.pictor.createSession(null, 'e2e 内核插件', 'fake'),
    )
    assert.equal(created.kernelId, 'fake', 'a conversation keeps the kernel it was opened on')

    await page.reload()
    await page.waitForSelector('header', { timeout: 30_000 })
    // The installed kernel gets a page of its own, named by the label it reports —
    // that is what makes "adding a kernel is adding a directory" true in the window
    // too, and not only in the container.
    await openKernel(page, '回声（示例）')
    await page.getByRole('button', { name: 'e2e 内核插件' }).first().click({ timeout: 15_000 })
    await page.getByLabel('消息输入').waitFor({ timeout: 20_000 })

    // A turn through the installed kernel, observed the way a person would: the
    // answer appears in the transcript.
    const input = page.getByLabel('消息输入')
    await input.fill('你好')
    await input.press('Enter')
    await page.getByText('回声：你好').first().waitFor({ timeout: 30_000 })
  },
}
