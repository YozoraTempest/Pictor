import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { expect, test } from './pi-extension-fixture.js'
import { invokeAgentWorkspace } from './support.js'

test('navigates, summarizes, and compacts an imported Pi Session', async ({ piExtension }) => {
  const {
    importSession,
    projectRoot,
    recordRuntimeEvents,
    runtimeEvents,
    startSelectedRun,
    window,
  } = piExtension
  const imported = await importSession()
  const authoritativeJsonlPath = imported.history.piSessionPath
  const historyBeforeNavigation = await invokeAgentWorkspace(window, 'inspectSessionHistory', {
    sessionId: imported.sessionId,
    entryId: null,
  })
  if (!historyBeforeNavigation.ok || !historyBeforeNavigation.value.tree?.activeLeafId) {
    throw new Error('Imported Pi Session has no active leaf')
  }
  const activeLeafBeforeNavigation = historyBeforeNavigation.value.tree.activeLeafId

  await window.getByRole('button', { name: 'Session Tree', exact: true }).click()
  const navigationTree = window.getByRole('complementary', { name: 'Session Tree' })
  await navigationTree.getByRole('button', { name: 'Imported original answer' }).click()
  await expect(window.getByRole('button', { name: '切换到此节点', exact: true })).toBeEnabled()
  await window.getByRole('button', { name: '切换到此节点', exact: true }).click()

  const timeline = window.locator('.timeline')
  await expect(timeline.getByText('Imported original answer')).toBeVisible()
  await expect(timeline.getByText('Imported branch answer')).toHaveCount(0)
  await expect(window.getByRole('textbox', { name: '任务描述' })).toBeEnabled()

  const navigatedHistory = await invokeAgentWorkspace(window, 'inspectSessionHistory', {
    sessionId: imported.sessionId,
    entryId: null,
  })
  expect(navigatedHistory).toMatchObject({
    ok: true,
    value: {
      tree: { activeLeafId: 'imported-original', selectedEntryId: 'imported-original' },
    },
  })
  const metadataAfterNavigation = JSON.parse(await readFile(imported.path, 'utf8')) as {
    history: { piSessionPath: string; activeLeafId?: string | null }
  }
  expect(metadataAfterNavigation.history).toMatchObject({
    piSessionPath: imported.history.piSessionPath,
    activeLeafId: 'imported-original',
  })
  await expect
    .poll(() => readFile(resolve(projectRoot, 'fork-lifecycle.log'), 'utf8'))
    .toEqual(expect.stringContaining(`before_tree:imported-original:${activeLeafBeforeNavigation}`))
  const treeLifecycle = await readFile(resolve(projectRoot, 'fork-lifecycle.log'), 'utf8')
  expect(treeLifecycle).toContain(`tree:${activeLeafBeforeNavigation}:imported-original`)

  await recordRuntimeEvents(imported.sessionId)
  expect(await startSelectedRun('Continue from the historical answer.')).toMatchObject({ ok: true })
  await expect
    .poll(
      async () =>
        (await runtimeEvents()).find(
          (event) =>
            event.type === 'run.stateChanged' &&
            ['completed', 'failed', 'stopped', 'interrupted'].includes(String(event.status)),
        ) ?? null,
      { timeout: 30_000 },
    )
    .not.toBeNull()
  expect((await runtimeEvents()).filter((event) => event.type === 'runtime.error')).toEqual([])
  await expect
    .poll(() => readFile(authoritativeJsonlPath, 'utf8'))
    .toContain('Continue from the historical answer.')
  await expect(timeline.getByText('Native extension completed.')).toBeVisible({ timeout: 30_000 })
  await expect(timeline.getByText('Imported branch answer')).toHaveCount(0)
  const metadataAfterRun = JSON.parse(await readFile(imported.path, 'utf8')) as {
    history: { piSessionPath: string; activeLeafId?: string | null }
  }
  expect(metadataAfterRun.history.piSessionPath).toBe(imported.history.piSessionPath)
  expect(metadataAfterRun.history.activeLeafId).not.toBe('imported-original')
  await expect.poll(() => readFile(authoritativeJsonlPath, 'utf8')).toContain('session_info')
  expect(await readFile(authoritativeJsonlPath, 'utf8')).toContain('import-source (Import)')

  await window.getByRole('button', { name: 'Session Tree', exact: true }).click()
  await window.getByRole('button', { name: 'Session Tree', exact: true }).click()
  const branchTree = window.getByRole('complementary', { name: 'Session Tree' })
  await branchTree.getByRole('button', { name: 'Imported branch answer' }).click()
  await window.getByRole('button', { name: '总结后切换到此节点' }).click()
  await window.getByLabel('自定义摘要指令（可选）').fill('Preserve abandoned work')
  await window.getByRole('button', { name: '总结并切换' }).click()
  await expect(timeline.getByText('Branch summary').last()).toBeVisible({ timeout: 30_000 })
  await expect(timeline.getByText('E2E branch summary')).toBeVisible()
  const branchLifecycle = await readFile(resolve(projectRoot, 'fork-lifecycle.log'), 'utf8')
  expect(branchLifecycle).toContain('Preserve abandoned work')

  await branchTree.getByRole('button', { name: 'Imported branch task' }).click()
  await window.getByRole('button', { name: '切换到此节点', exact: true }).click()
  await expect(window.getByRole('textbox', { name: '任务描述' })).toHaveValue(
    'Imported branch task',
  )

  const cancelledCompaction = await invokeAgentWorkspace(window, 'compactSession', {
    sessionId: imported.sessionId,
    customInstructions: 'Cancel E2E compaction',
  })
  expect(cancelledCompaction).toEqual({ ok: true, value: null })

  await window.getByRole('button', { name: '压缩上下文' }).click()
  await window.getByLabel('自定义摘要指令（可选）').fill('Preserve E2E decisions')
  await window.getByRole('button', { name: '开始压缩' }).click()
  await expect(timeline.getByText('E2E compacted context')).toBeVisible({ timeout: 30_000 })
  const compactedTree = window.getByRole('complementary', { name: 'Session Tree' })
  await expect(compactedTree.getByRole('button', { name: 'Compaction summary' })).toBeVisible()
  const compactionLifecycle = await readFile(resolve(projectRoot, 'fork-lifecycle.log'), 'utf8')
  expect(compactionLifecycle).toContain('before_compact:manual:Cancel E2E compaction')
  expect(compactionLifecycle).toContain('before_compact:manual:Preserve E2E decisions')
  expect(compactionLifecycle).toContain('compact:manual:E2E compacted context')

  expect(await startSelectedRun('Continue after compaction.')).toMatchObject({ ok: true })
  await expect
    .poll(() => readFile(authoritativeJsonlPath, 'utf8'))
    .toContain('Continue after compaction.')
})
