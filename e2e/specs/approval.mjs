import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { startStubModel } from '../stub-model.mjs'
import { openKernel } from '../harness.mjs'

/**
 * One tool call the sandbox refuses, and the escalated retry the reader decides.
 *
 * An approval is not "anything outside the workspace asks": the sandbox denies,
 * the tool reports that an escalation is available, and only the retry that names
 * `sandbox_permissions` becomes a question. The spec walks that path twice — once
 * allowed, once refused — because both branches end in a different file.
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export default {
  name: '审批流',
  async run(page, app) {
    if (app.dsh === null) {
      return { skip: '没有找到 DeepSeek 运行时；设置 PICTOR_DSH_BIN 或先运行一次应用' }
    }

    // Outside the workspace on purpose: inside it the sandbox simply allows the
    // write and no question is asked.
    const stamp = String(Date.now())
    const allowedPath = join(homedir(), `pictor-e2e-allowed-${stamp}.txt`)
    const refusedPath = join(homedir(), `pictor-e2e-refused-${stamp}.txt`)
    for (const path of [allowedPath, refusedPath]) rmSync(path, { force: true })

    const plan = (path) => [
      { name: 'write', arguments: { file_path: path, content: 'hi from e2e\n' } },
      {
        name: 'write',
        arguments: {
          file_path: path,
          content: 'hi from e2e\n',
          sandbox_permissions: 'danger-full-access',
          justification: 'e2e：写到工作区之外，需要一次升权',
        },
      },
    ]
    const model = await startStubModel({ toolCalls: plan(allowedPath), reply: '写好了。' })
    const refusal = await startStubModel({ toolCalls: plan(refusedPath), reply: '没有写。' })

    const waitForCard = async (timeout) => {
      const card = page.getByText('需要你的批准')
      for (let attempt = 0; attempt < timeout / 250; attempt += 1) {
        if ((await card.count()) > 0) return
        await sleep(250)
      }
      throw new Error('the runtime never asked for an approval')
    }

    try {
      // Two services, one runtime: the first case answers, the second one refuses.
      const listProvider = async (stub, name) => {
        const listed = await page.evaluate((input) => window.pictor.saveProvider(input), {
          name,
          baseUrl: stub.baseUrl,
          protocol: 'openai-completions',
          modelId: 'stub-model',
          models: [{ id: 'stub-model' }],
          apiKey: 'e2e-key',
        })
        const saved = listed.providers.find((provider) => provider.baseUrl === stub.baseUrl)
        assert.ok(saved !== undefined, `${name} was saved`)
        return saved.id
      }

      const allowedId = await listProvider(model, 'e2e 审批-允许')
      await page.evaluate((id) => window.pictor.activateProvider(id), allowedId)
      await page.evaluate(() => window.pictor.harnessStop())
      const booted = await page.evaluate((cwd) => window.pictor.harnessStart(cwd), app.workdir)
      assert.equal(booted.state, 'ready', `the runtime booted: ${booted.error ?? ''}`)

      // 1. Allowed: the file only exists because the reader said yes.
      const first = await page.evaluate(() => window.pictor.createSession(null, 'e2e 审批允许'))
      await page.reload()
      await page.waitForSelector('header', { timeout: 30_000 })
      await openKernel(page, 'DSH')
      await page.getByRole('button', { name: 'e2e 审批允许' }).first().click({ timeout: 15_000 })
      await page.getByLabel('消息输入').fill('写一个文件')
      await page.getByLabel('消息输入').press('Enter')

      await waitForCard(30_000)
      const wanted = await page.getByText('需要你的批准').first().locator('xpath=../../..')
      const text = await wanted.innerText()
      assert.match(text, /write/, 'the card names the tool')
      assert.match(text, /danger-full-access/, 'and the wider mode it would get')

      await page.getByRole('button', { name: '允许一次' }).click()
      await page.getByText('写好了。').first().waitFor({ timeout: 60_000 })
      assert.equal(existsSync(allowedPath), true, 'the allowed write reached the file')
      assert.equal(readFileSync(allowedPath, 'utf8'), 'hi from e2e\n')
      assert.equal(await page.getByText('需要你的批准').count(), 0, 'the card closes on an answer')
      assert.ok(first.id.length > 0)

      // 2. Refused: the same path, answered the other way, leaves nothing behind.
      const refusedId = await listProvider(refusal, 'e2e 审批-拒绝')
      await page.evaluate((id) => window.pictor.activateProvider(id), refusedId)

      const second = await page.evaluate(() => window.pictor.createSession(null, 'e2e 审批拒绝'))
      await page.reload()
      await page.waitForSelector('header', { timeout: 30_000 })
      await openKernel(page, 'DSH')
      await page.getByRole('button', { name: 'e2e 审批拒绝' }).first().click({ timeout: 15_000 })
      await page.getByLabel('消息输入').fill('再写一个文件')
      await page.getByLabel('消息输入').press('Enter')

      await waitForCard(60_000)
      await page.getByRole('button', { name: '拒绝', exact: true }).click()
      await page.getByText('需要你的批准').first().waitFor({ state: 'detached', timeout: 30_000 })
      assert.equal(existsSync(refusedPath), false, 'a refused escalation writes nothing')

      // The turn still ended instead of holding the conversation forever.
      const settled = await page.evaluate(async (id) => {
        for (let attempt = 0; attempt < 60; attempt += 1) {
          const history = await window.pictor.chatHistory(`harness:${id}`, 50, 0)
          if (history.messages.some((message) => message.role === 'assistant')) return true
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
        return false
      }, second.id)
      assert.equal(settled, true, 'the refused turn finished')
    } finally {
      await model.close()
      await refusal.close()
      for (const path of [allowedPath, refusedPath]) rmSync(path, { force: true })
    }
  },
}
