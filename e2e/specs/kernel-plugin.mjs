import assert from 'node:assert/strict'

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
    // An installed kernel has no rail page of its own yet, so its conversation is
    // opened the way a person reaches anything not in front of them: the search
    // palette, which spans every kernel and jumps to the one that holds the match.
    await page.getByRole('button', { name: '搜索会话' }).first().click()
    await page.getByPlaceholder('按标题或项目名搜索').fill('e2e 内核插件')
    await page.getByPlaceholder('按标题或项目名搜索').press('Enter')
    await page.getByLabel('消息输入').waitFor({ timeout: 20_000 })

    // A turn through the installed kernel, observed the way a person would: the
    // answer appears in the transcript.
    const input = page.getByLabel('消息输入')
    await input.fill('你好')
    await input.press('Enter')
    await page.getByText('回声：你好').first().waitFor({ timeout: 30_000 })
  },
}
