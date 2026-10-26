import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Installing and removing a kernel while the app runs.
 *
 * The harness also drops one kernel in before launch, which covers the "it is on
 * disk at startup" path; this spec covers the other one — the person clicks install,
 * and the kernel is available without restarting. It uses a directory, because that
 * path needs no network, and it deliberately installs and removes the same spec twice
 * so a half-cleaned removal shows up as a failure rather than as a second kernel.
 */
export default {
  name: '内核安装',
  async run(page) {
    const root = join(mkdtempSync(join(tmpdir(), 'pictor-kernel-install-')), 'probe-kernel')
    mkdirSync(root, { recursive: true })
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'probe-kernel', version: '0.0.0', type: 'module', main: 'index.js' }),
      'utf8',
    )
    writeFileSync(
      join(root, 'index.js'),
      `export function apply(ctx) {
  ctx.provide('kernel.probe', {
    id: 'probe',
    label: '探针内核',
    capabilities: { permission: false, approval: false, model: false, skills: false, fork: false },
    async start() { return status() },
    async stop() { return status() },
    status: () => ({
      state: 'ready',
      binary: 'probe-kernel',
      version: '0.0.0',
      expectedVersion: '0.0.0',
      home: '',
      provider: null,
      model: null,
      serverInfo: null,
      permissionMode: 'workspace-write',
      error: null,
    }),
    async install() { return status() },
    async prompt() {},
    async cancel() {},
    async fork() { throw new Error('这个内核不会分叉') },
    adopt() {},
    async openHistory() { return { messages: [], nextOffset: 0, hasMore: false } },
    async historyPage() { return { messages: [], nextOffset: 0, hasMore: false } },
    onNotification() { return () => undefined },
    async answerApproval() {},
    async answerQuestions() {},
    setPermissionMode() {},
    async applyPermission() {},
    async applySettings() {},
    async sessionPermission() { return null },
    async setSessionPermission() {},
    async projectRootFor() { return null },
    async listSkills() { return [] },
    async probe(prompt) { return { ok: true, text: prompt, events: [] } },
  })
}
`,
      'utf8',
    )

    const installed = await page.evaluate((path) => window.pictor.installKernelFolder(path), root)
    assert.equal(installed.ok, true, `安装失败：${installed.message}`)

    // Mounted without a restart: the picker reads the same live map the host fills.
    const kernels = await page.evaluate(() => window.pictor.listKernels())
    const probe = kernels.find((kernel) => kernel.id === 'probe')
    assert.ok(probe !== undefined, '装完就能在首页选到')
    assert.equal(probe.label, '探针内核')

    const listed = await page.evaluate(() => window.pictor.listKernelPlugins())
    const entry = listed.find((plugin) => plugin.id === 'probe')
    assert.equal(entry?.source, 'probe-kernel', '来源是安装的目录名')
    assert.equal(entry?.failure, null)

    const removed = await page.evaluate(() => window.pictor.removeKernel('probe'))
    assert.equal(removed.ok, true, `卸载失败：${removed.message}`)

    const after = await page.evaluate(() => window.pictor.listKernels())
    assert.equal(
      after.some((kernel) => kernel.id === 'probe'),
      false,
      '卸载后不再出现在选择器里',
    )

    // The same directory installs again: removal has to have cleaned the disk, not
    // just the mounted list.
    const again = await page.evaluate((path) => window.pictor.installKernelFolder(path), root)
    assert.equal(again.ok, true, `重装失败：${again.message}`)
    await page.evaluate(() => window.pictor.removeKernel('probe'))
  },
}
