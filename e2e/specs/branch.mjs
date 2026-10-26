import assert from 'node:assert/strict'

import { openKernel } from '../harness.mjs'
import { startStubModel } from '../stub-model.mjs'

/**
 * Branching from a message, and the tree that makes branches legible.
 *
 * Two turns are answered, then the conversation is branched twice: once from the
 * first answer (a branch that keeps it) and once from the first question (a branch
 * that stops there). The tree then has to show all three conversations under the
 * one they came from.
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export default {
  name: '分支与分支树',
  async run(page, app) {
    if (app.dsh === null) {
      return { skip: '没有找到 DeepSeek 运行时；设置 PICTOR_DSH_BIN 或先运行一次应用' }
    }

    const first = '第一轮的回答。'
    const second = '第二轮的回答。'
    // Four answers, because the rewind case runs a second conversation of its own: the
    // stub hands them out in order across the whole app, not per session.
    const model = await startStubModel({
      replies: [first, second, first, second],
      title: 'e2e 分叉源',
    })

    const transcript = (sessionId) =>
      page.evaluate((id) => window.pictor.chatHistory(`harness:${id}`, 50, 0), sessionId)

    const waitForText = async (sessionId, needle) => {
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const history = await transcript(sessionId)
        if (history.messages.some((message) => message.text.includes(needle))) return
        await sleep(250)
      }
      throw new Error(`the transcript never contained: ${needle}`)
    }

    /**
     * Wait for the window to settle on a state.
     *
     * A branch opens asynchronously after the fork, so an assertion about what must
     * *not* be on screen has to wait for the old transcript to go away instead of
     * reading it a moment too early.
     */
    const waitUntil = async (predicate, what) => {
      for (let attempt = 0; attempt < 120; attempt += 1) {
        if (await predicate()) return
        await sleep(250)
      }
      throw new Error(`timed out waiting for ${what}`)
    }

    try {
      // The service has to be pointed at this endpoint and the runtime started on
      // it; that is also what makes the wait below worth anything.
      const listed = await page.evaluate(
        (baseUrl) =>
          window.pictor.saveProvider({
            name: 'e2e 分支',
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

      const booted = await page.evaluate((cwd) => window.pictor.harnessStart(cwd), app.workdir)
      assert.equal(booted.state, 'ready', `the runtime booted: ${booted.error ?? ''}`)

      const session = await page.evaluate(() => window.pictor.createSession(null, 'e2e 分叉源'))
      for (const prompt of ['第一问', '第二问']) {
        await page.evaluate(([id, text]) => window.pictor.sendChat(id, text), [session.id, prompt])
      }
      await waitForText(session.id, first)
      await waitForText(session.id, second)

      // Reopening is what gives every row its sequence, which is the boundary a
      // fork needs.
      await page.reload()
      await page.waitForSelector('header', { timeout: 30_000 })
      await openKernel(page, 'DeepSeek Harness')
      await page.getByRole('button', { name: 'e2e 分叉源' }).first().click({ timeout: 15_000 })
      await page.getByText(second).first().waitFor({ timeout: 30_000 })

      // 1. Branch from the first answer: the copy keeps that answer, not the next.
      await page.getByText(first).first().hover()
      await page.getByRole('button', { name: '从这条回答分叉' }).first().click()
      await page
        .getByRole('button', { name: /e2e 分叉源 · 分支/ })
        .first()
        .waitFor({
          timeout: 30_000,
        })
      await waitUntil(
        async () =>
          (await page.getByText(first).count()) === 1 &&
          (await page.getByText(second).count()) === 0,
        'the branch to hold the first turn only',
      )

      // 2. The toolbar now offers the tree, and it lists the family.
      await page.getByRole('button', { name: '分支树', exact: true }).click({ timeout: 15_000 })
      const tree = page.getByRole('dialog', { name: '分支树' })
      await tree.waitFor({ timeout: 10_000 })
      const rows = await tree.locator('li').allInnerTexts()
      assert.equal(rows.length, 2, `the tree lists both conversations: ${rows.join(' / ')}`)
      assert.match(rows[0] ?? '', /e2e 分叉源/, 'the source is the root of the tree')
      await tree
        .getByRole('button', { name: /e2e 分叉源$/ })
        .first()
        .click()
      await page.getByText(second).first().waitFor({ timeout: 30_000 })

      // 3. Branch before a question: the copy ends with the previous turn, so the
      //    question can be asked differently in the new conversation.
      await page.getByText('第二问').first().hover()
      await page.getByRole('button', { name: '在这一问之前分叉' }).first().click()
      await waitUntil(
        async () =>
          (await page.getByText(first).count()) === 1 &&
          (await page.getByText('第二问').count()) === 0 &&
          (await page.getByText(second).count()) === 0,
        'the copy to end before the second question',
      )

      // 4. 回到这里: the same cut, but the conversation that was left is filed instead of
      //    kept beside it. It is reversible, so the assertion is about where it went, not
      //    that it vanished.
      const source = await page.evaluate(() => window.pictor.createSession(null, 'e2e 回滚源'))
      for (const prompt of ['回滚第一问', '回滚第二问']) {
        await page.evaluate(([id, text]) => window.pictor.sendChat(id, text), [source.id, prompt])
      }
      await waitForText(source.id, first)
      await waitForText(source.id, second)

      const sourceHistory = await page.evaluate((id) => window.pictor.openChat(id), source.id)
      const answerOfFirst = [...sourceHistory.history.messages]
        .reverse()
        .find((message) => message.role === 'assistant' && message.text.includes(first))
      assert.ok(answerOfFirst !== undefined, 'the first answer is a boundary to go back to')

      const rewind = await page.evaluate(
        ([id, point]) => window.pictor.rewindSession(id, point),
        [source.id, { seq: answerOfFirst.seq }],
      )
      assert.equal(rewind.archived, true, 'the conversation that was left is filed, not lost')

      const settled = await page.evaluate(() => window.pictor.getSnapshot(), null)
      const left = settled.sessions.find((entry) => entry.id === source.id)
      const branch = settled.sessions.find((entry) => entry.id === rewind.id)
      assert.equal(left?.archived, true, 'the source is archived')
      assert.equal(branch?.parentId, source.id, 'the branch points back at its source')

      const branchRows = await page.evaluate((id) => window.pictor.openChat(id), rewind.id)
      const texts = branchRows.history.messages.map((message) => message.text)
      assert.ok(
        texts.some((text) => text.includes(first)) && !texts.some((text) => text.includes(second)),
        `the branch stops before the second turn: ${texts.join(' / ')}`,
      )

      // Undo it the way the notice says: the archived conversation comes back.
      await page.evaluate((id) => window.pictor.setSessionArchived(id, false), source.id)
      const restored = await page.evaluate(() => window.pictor.getSnapshot(), null)
      assert.equal(
        restored.sessions.find((entry) => entry.id === source.id)?.archived,
        false,
        'archiving is reversible',
      )
    } finally {
      await model.close()
    }
  },
}
