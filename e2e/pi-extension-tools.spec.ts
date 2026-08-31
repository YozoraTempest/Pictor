import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { expect, test } from './pi-extension-fixture.js'
import { invokeAgentWorkspace } from './support.js'

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

test('forks and clones a Pi Session through native lifecycle events', async ({ piExtension }) => {
  const { projectRoot, queueToolCall, startSelectedRun, window } = piExtension

  queueToolCall('hello')
  expect(await startSelectedRun('Use the hello tool.')).toMatchObject({ ok: true })
  await expect(window.getByText('Hello, Pictor!')).toBeAttached({ timeout: 30_000 })
  await expect(window.getByText('已完成').last()).toBeVisible({ timeout: 30_000 })

  queueToolCall('ask_gui')
  expect(await startSelectedRun('Ask through the GUI.')).toMatchObject({ ok: true })
  await expect(window.getByRole('heading', { name: 'Enter a value' })).toBeVisible()
  await window.getByLabel('输入').fill('GUI response')
  await window.getByRole('button', { name: '确认' }).click()
  const guiTool = window.locator('.tool-activity').filter({ hasText: 'ask_gui' })
  await expect(guiTool.getByText('GUI response')).toBeAttached({ timeout: 30_000 })
  await expect(window.getByText('已完成').last()).toBeVisible({ timeout: 30_000 })

  await window.getByRole('button', { name: 'Session Tree' }).click()
  const tree = window.getByRole('complementary', { name: 'Session Tree' })
  await tree.getByRole('button', { name: 'Native extension completed.' }).first().click()
  await expect(window.getByText(/正在查看历史分支/)).toBeVisible()
  await tree.getByRole('button', { name: 'Fork 为新 Session' }).click()

  await expect(window.getByRole('heading', { name: 'Use the hello tool. (Fork)' })).toBeVisible({
    timeout: 30_000,
  })
  await expect(window.locator('.timeline').getByText('Native extension completed.')).toBeVisible()
  const forkedSnapshot = await invokeAgentWorkspace(window, 'getSnapshot', null)
  expect(forkedSnapshot).toMatchObject({
    ok: true,
    value: {
      selectedSessionId: expect.any(String),
      sessions: expect.arrayContaining([
        expect.objectContaining({ title: 'Use the hello tool. (Fork)' }),
      ]),
    },
  })
  await expect
    .poll(() => readFile(resolve(projectRoot, 'fork-lifecycle.log'), 'utf8'))
    .toEqual(expect.stringContaining('before_fork:'))
  const lifecycle = await readFile(resolve(projectRoot, 'fork-lifecycle.log'), 'utf8')
  expect(lifecycle).toContain('shutdown:fork')
  expect(lifecycle).toContain('start:fork')

  await window.getByRole('button', { name: 'Session Tree' }).click()
  const forkTree = window.getByRole('complementary', { name: 'Session Tree' })
  const cloneButton = forkTree.getByRole('button', { name: 'Clone 当前分支为新 Session' })
  await expect(cloneButton).toBeEnabled()
  await cloneButton.click()

  await expect(
    window.getByRole('heading', { name: 'Use the hello tool. (Fork) (Clone)' }),
  ).toBeVisible({ timeout: 30_000 })
  const clonedSnapshot = await invokeAgentWorkspace(window, 'getSnapshot', null)
  expect(clonedSnapshot).toMatchObject({
    ok: true,
    value: {
      selectedSessionId: expect.any(String),
      sessions: expect.arrayContaining([
        expect.objectContaining({ title: 'Use the hello tool. (Fork) (Clone)' }),
      ]),
    },
  })
  await expect
    .poll(async () => {
      const values = await readFile(resolve(projectRoot, 'fork-lifecycle.log'), 'utf8')
      return values.split('\n').filter((value) => value.startsWith('before_fork:')).length
    })
    .toBe(2)
  const clonedLifecycle = await readFile(resolve(projectRoot, 'fork-lifecycle.log'), 'utf8')
  expect(clonedLifecycle.match(/shutdown:fork/g)).toHaveLength(2)
  expect(clonedLifecycle.match(/start:fork/g)).toHaveLength(2)
})
