import assert from 'node:assert/strict'

import { openKernel } from '../harness.mjs'

/**
 * Archiving must be undoable, and sweeping archives must ask first.
 *
 * A fresh profile has no conversations, so the spec creates one through the
 * bridge, drives the row menu, and checks the conversation survives a round trip
 * through 已归档.
 */
export default {
  name: 'archive round trip',
  async run(page, app) {
    // A throwaway profile has no projects, and only a project (or a custom
    // section) offers a sweeping archive — so the spec builds one.
    const project = await page.evaluate(
      (path) => window.pictor.addProject(path, 'e2e 项目'),
      app.workdir,
    )

    const created = await page.evaluate(
      (projectId) => window.pictor.createSession(projectId, 'e2e 归档往返', null),
      project.id,
    )
    assert.ok(created.id, 'the session was created')

    await page.reload()
    await page.waitForSelector('header', { timeout: 30_000 })
    await openKernel(page, 'DSH')

    const row = page.locator(`button[aria-label="${created.title} 更多操作"]`).first()
    await row.waitFor({ timeout: 10_000 })
    await row.click()

    const menu = page.getByRole('menu')
    await menu.waitFor({ timeout: 5_000 })
    await menu.getByText('归档聊天', { exact: true }).click()

    // Archived: the row's own menu now offers the way back.
    await page
      .getByRole('button', { name: `${created.title} 更多操作` })
      .first()
      .click({ timeout: 10_000 })
    const restore = page.getByRole('menu').getByText('取消归档', { exact: true })
    await restore.waitFor({ timeout: 5_000 })
    await restore.click()

    const after = await page.evaluate(() => window.pictor.getSnapshot())
    const session = after.sessions.find((entry) => entry.id === created.id)
    assert.equal(session?.archived, false, 'the conversation came back out of the archive')

    // The sweeping archive asks before moving a whole project's conversations.
    const projectMenu = page.getByRole('button', { name: `${project.name} 更多操作` }).first()
    await projectMenu.click()
    const archiveAll = page.getByRole('menu').getByText('归档聊天', { exact: true })
    await archiveAll.waitFor({ timeout: 5_000 })
    await archiveAll.click()

    const dialog = page.getByRole('dialog', { name: '归档聊天' })
    await dialog.waitFor({ timeout: 5_000 })
    const body = await dialog.innerText()
    assert.match(body, /已归档/, 'the dialog says where the conversations go')

    await dialog.getByRole('button', { name: '取消' }).click()
    await dialog.waitFor({ state: 'detached', timeout: 5_000 })

    const untouched = await page.evaluate(() => window.pictor.getSnapshot())
    assert.equal(
      untouched.sessions.some((entry) => entry.archived),
      false,
      'cancelling leaves every conversation alone',
    )
  },
}
