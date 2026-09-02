import { expect, test } from './pi-extension-fixture.js'

test('executes native Extension tools and resolves GUI RPC input', async ({ piExtension }) => {
  const { queueToolCall, startSelectedRun, window } = piExtension

  queueToolCall('hello')
  expect(await startSelectedRun('Use the hello tool.')).toMatchObject({ ok: true })
  await expect(window.getByText('Extension Tool')).toBeVisible({ timeout: 30_000 })
  await window.getByText('查看输出').click()
  await expect(window.getByText('Hello, Pictor!')).toBeVisible({ timeout: 30_000 })
  await expect(window.getByText('Native extension completed.')).toBeVisible({ timeout: 30_000 })
  await expect(window.getByText('已完成').last()).toBeVisible({ timeout: 30_000 })

  queueToolCall('ask_gui')
  expect(await startSelectedRun('Ask through the GUI.')).toMatchObject({ ok: true })
  await expect(window.getByRole('heading', { name: 'Enter a value' })).toBeVisible()
  await window.getByLabel('输入').fill('GUI response')
  await window.getByRole('button', { name: '确认' }).click()
  const guiTool = window.locator('.tool-activity').filter({ hasText: 'ask_gui' })
  await expect(guiTool.getByText('GUI response')).toBeAttached({ timeout: 30_000 })
  await guiTool.getByText('查看输出').click()
  await expect(guiTool.getByText('GUI response')).toBeVisible()
  await expect(window.getByText('Native extension completed.').last()).toBeVisible({
    timeout: 30_000,
  })
  await expect(window.getByText('已完成').last()).toBeVisible({ timeout: 30_000 })
})
