import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { openKernel } from '../harness.mjs'
import { startStubModel } from '../stub-model.mjs'

/**
 * Where a conversation runs, which is a property of its project.
 *
 * One runtime process serves every conversation, so a single global working
 * directory would make two projects write into the same tree. The runtime takes a
 * cwd per session and roots the sandbox there, so this spec files a conversation
 * under each of two projects and checks that the same relative write lands in the
 * project it belongs to — and nowhere else.
 */
export default {
  name: '会话工作目录',
  async run(page, app) {
    if (app.dsh === null) {
      return { skip: '没有找到 DeepSeek 运行时；设置 PICTOR_DSH_BIN 或先运行一次应用' }
    }

    const left = join(app.workdir, 'cwd-left')
    const right = join(app.workdir, 'cwd-right')
    for (const directory of [left, right]) {
      mkdirSync(directory, { recursive: true })
      // A repository marker is what makes the directory a project root for the
      // runtime's own root ranking.
      mkdirSync(join(directory, '.git'), { recursive: true })
    }

    const model = await startStubModel({
      reply: '写好了。',
      // Relative on purpose: the sandbox decides what it resolves against.
      toolCalls: [{ name: 'write', arguments: { file_path: 'note.txt', content: 'hello' } }],
    })

    try {
      const listed = await page.evaluate(
        (baseUrl) =>
          window.pictor.saveProvider({
            name: 'e2e 工作目录',
            baseUrl,
            protocol: 'openai-completions',
            modelId: 'stub-model',
            models: [{ id: 'stub-model' }],
            apiKey: 'e2e-key',
          }),
        model.baseUrl,
      )
      const provider = listed.providers.find((entry) => entry.baseUrl === model.baseUrl)
      assert.ok(provider !== undefined, 'the provider was saved')
      await page.evaluate((id) => window.pictor.activateProvider(id), provider.id)

      // Distinct names from the conversations, so a click on a title is unambiguous.
      const leftProject = await page.evaluate(
        (path) => window.pictor.addProject(path, 'proj-left'),
        left,
      )
      const rightProject = await page.evaluate(
        (path) => window.pictor.addProject(path, 'proj-right'),
        right,
      )

      await page.evaluate(() => window.pictor.harnessStop())
      const status = await page.evaluate((cwd) => window.pictor.harnessStart(cwd), app.workdir)
      assert.equal(status.state, 'ready', `the runtime booted: ${status.error ?? ''}`)

      await page.reload()
      await page.waitForSelector('header', { timeout: 30_000 })

      // One conversation per project, filed under it before the runtime ever creates
      // the session: the cwd is fixed at creation, so the filing has to come first.
      for (const [project, marker] of [
        [leftProject, 'left'],
        [rightProject, 'right'],
      ]) {
        const title = `cwd-${marker}`
        await page.evaluate(
          ([id, name]) => window.pictor.createSession(id, name),
          [project.id, title],
        )
        await page.reload()
        await page.waitForSelector('header', { timeout: 30_000 })
        await openKernel(page, 'DeepSeek Harness')
        await page.getByRole('button', { name: title }).first().click({ timeout: 15_000 })

        const input = page.getByLabel('消息输入')
        await input.waitFor({ timeout: 20_000 })
        await input.fill(`在 ${marker} 里写一个文件`)
        await input.press('Enter')
        await page.getByText('写好了。').last().waitFor({ timeout: 60_000 })
      }

      // The same relative write, once per conversation: the runtime resolves it
      // against each session's own directory, so both projects get their own file.
      assert.ok(existsSync(join(left, 'note.txt')), 'the left conversation wrote into its project')
      assert.ok(
        existsSync(join(right, 'note.txt')),
        'the right conversation wrote into its project',
      )
      // The process-wide start directory is only a fallback; nothing resolved here.
      assert.ok(
        !existsSync(join(app.workdir, 'note.txt')),
        'a relative path did not fall back to the runtime start directory',
      )
      writeFileSync(join(app.workdir, 'cwd-check.log'), 'checked\n')
    } finally {
      await model.close()
      // The runtime keeps a write handle per conversation; a later spec must not
      // inherit this one's streams.
      await page.evaluate(() => window.pictor.harnessStop()).catch(() => undefined)
    }
  },
}
