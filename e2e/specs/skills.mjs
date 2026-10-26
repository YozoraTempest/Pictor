import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { startStubModel } from '../stub-model.mjs'

/**
 * One skill, from a file on disk to the model's request.
 *
 * Three programs have to agree for this to work: the runtime's filesystem
 * provider scans the profile's user root, `/` in the composer names the skill,
 * and the runtime turns that name into a `<skill_content>` block before the
 * request leaves. Each of those is invisible to a unit test, and a marker in the
 * skill body is the only proof they lined up.
 */
export default {
  name: '技能',
  async run(page, app) {
    if (app.dsh === null) {
      return { skip: '没有找到 DeepSeek 运行时；设置 PICTOR_DSH_BIN 或先运行一次应用' }
    }

    const marker = 'E2E_SKILL_MARKER'
    const directory = join(app.profile, 'harness', 'skills', 'e2e-skill')
    mkdirSync(directory, { recursive: true })
    writeFileSync(
      join(directory, 'SKILL.md'),
      `---\nname: e2e-skill\ndescription: 端到端技能，用来证明 / 触发链路。\n---\n\n${marker}\n`,
    )

    const reply = '技能已生效。'
    const model = await startStubModel({ reply })

    try {
      const listed = await page.evaluate(
        (baseUrl) =>
          window.pictor.saveProvider({
            name: 'e2e 技能',
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

      // A fresh working directory and a restart: the catalog is scanned when the
      // runtime boots, so the file above has to be there before this line.
      const workdir = join(app.workdir, 'skills')
      mkdirSync(workdir, { recursive: true })
      await page.evaluate(() => window.pictor.harnessStop())
      const status = await page.evaluate((cwd) => window.pictor.harnessStart(cwd), workdir)
      assert.equal(status.state, 'ready', `the runtime booted: ${status.error ?? ''}`)

      await page.reload()
      await page.waitForSelector('header', { timeout: 30_000 })
      await page.keyboard.press('Control+n')

      const input = page.getByLabel('消息输入')
      await input.waitFor({ timeout: 15_000 })
      await input.fill('/')

      // The menu lists what the conversation can actually load — the runtime's
      // catalog, not a list Pictor keeps on its own. Kernel commands share the menu
      // and come first, so a query narrows to the skill being tested.
      const menu = page.getByRole('listbox', { name: '选择技能' })
      await menu.waitFor({ timeout: 15_000 })
      await menu.getByText('/e2e-skill').waitFor({ timeout: 10_000 })
      await input.fill('/e2e')

      // Enter completes the name; it must not send a draft holding just `/`.
      await input.press('Enter')
      assert.equal(await input.inputValue(), '/e2e-skill ', 'the name was completed, not sent')

      await input.pressSequentially('执行')
      await input.press('Enter')

      await page.getByText(reply).first().waitFor({ timeout: 60_000 })
      assert.ok(
        model.calls.some((call) => call.text.includes(marker)),
        'the runtime injected the skill body the user invoked',
      )
    } finally {
      await model.close()
    }
  },
}
