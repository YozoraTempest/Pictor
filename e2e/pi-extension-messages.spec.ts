import { readFile } from 'node:fs/promises'

import { expect, test } from './pi-extension-fixture.js'

function terminalEventCount(events: Array<Record<string, unknown>>): number {
  return events.filter(
    (event) =>
      event.type === 'run.stateChanged' &&
      ['completed', 'failed', 'stopped', 'interrupted'].includes(String(event.status)),
  ).length
}

test('persists image prompts and Extension command messages', async ({ piExtension }) => {
  const {
    clearRuntimeEvents,
    electronApp,
    imageFixture,
    recordRuntimeEvents,
    runtimeEvents,
    selectedSessionMetadata,
    sessionId,
    startSelectedRun,
    window,
  } = piExtension
  await recordRuntimeEvents(sessionId)

  await expect(window.getByRole('button', { name: '发送任务' })).toHaveAttribute(
    'title',
    '发送任务',
  )
  await electronApp.evaluate(({ dialog }, imagePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [imagePath] })
  }, imageFixture)
  await window.getByRole('button', { name: '添加图片' }).click()
  await expect(window.getByAltText('fixture.png')).toBeVisible()
  await window.getByRole('textbox', { name: '任务描述' }).fill('Inspect the attached image.')
  await window.getByRole('button', { name: '发送任务' }).click()

  let authoritativeJsonlPath = ''
  await expect
    .poll(async () => {
      try {
        authoritativeJsonlPath = (await selectedSessionMetadata()).history.piSessionPath
        return authoritativeJsonlPath
      } catch {
        return ''
      }
    })
    .not.toBe('')
  await expect
    .poll(() => readFile(authoritativeJsonlPath, 'utf8').catch(() => ''), { timeout: 30_000 })
    .toContain('"type":"image"')
  await expect
    .poll(async () => terminalEventCount(await runtimeEvents()), { timeout: 30_000 })
    .toBe(1)

  expect(await startSelectedRun('/e2e-note hello')).toMatchObject({ ok: true })
  await expect
    .poll(() => readFile(authoritativeJsonlPath, 'utf8'))
    .toContain('Extension note: hello')
  const timeline = window.locator('.timeline')
  await expect(timeline.getByText('Extension note: hello')).toBeVisible({ timeout: 30_000 })
  expect(await readFile(authoritativeJsonlPath, 'utf8')).toContain('e2e-command-state')

  await clearRuntimeEvents()
  expect(await startSelectedRun('/e2e-user')).toMatchObject({ ok: true })
  await expect
    .poll(() => readFile(authoritativeJsonlPath, 'utf8'))
    .toContain('Extension-originated user message')
  await expect
    .poll(async () => terminalEventCount(await runtimeEvents()), { timeout: 30_000 })
    .toBe(1)

  expect(await startSelectedRun('/project-note')).toMatchObject({ ok: true })
  await expect
    .poll(() => readFile(authoritativeJsonlPath, 'utf8'))
    .toContain('Project Extension loaded')
  await expect
    .poll(async () => terminalEventCount(await runtimeEvents()), { timeout: 30_000 })
    .toBe(2)
})
