import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { expect, test } from './pi-extension-fixture.js'
import { invokeAgentWorkspace } from './support.js'

test('imports, configures, reloads, and exports a Pi Session without rewriting authority', async ({
  piExtension,
}, testInfo) => {
  const {
    electronApp,
    importSession,
    importSource,
    importedJsonl,
    projectRoot,
    startSelectedRun,
    window,
  } = piExtension
  const imported = await importSession()
  const authoritativeJsonlPath = imported.history.piSessionPath

  await expect(window.locator('.timeline').getByText('Imported branch answer')).toBeVisible()
  await window.getByRole('button', { name: 'Session Tree' }).click()
  const importedTree = window.getByRole('complementary', { name: 'Session Tree' })
  await expect(importedTree.getByRole('button', { name: 'Imported original answer' })).toBeVisible()
  await expect(importedTree.getByRole('button', { name: 'Imported branch answer' })).toBeVisible()
  await importedTree.getByRole('button', { name: 'Imported root task' }).click()
  await window.getByRole('button', { name: '标记节点' }).click()
  await window.getByLabel('Label').fill('root-checkpoint')
  await window.getByRole('button', { name: '保存' }).click()
  await expect(
    importedTree.getByRole('button', { name: 'root-checkpoint', exact: true }),
  ).toBeVisible()

  const importedSnapshot = await invokeAgentWorkspace(window, 'getSnapshot', null)
  expect(importedSnapshot).toMatchObject({
    ok: true,
    value: {
      selectedSessionId: imported.sessionId,
      sessions: expect.arrayContaining([
        expect.objectContaining({ id: imported.sessionId, title: 'import-source (Import)' }),
      ]),
    },
  })
  expect(await readFile(importSource, 'utf8')).toBe(importedJsonl)
  await expect
    .poll(() => readFile(resolve(projectRoot, 'fork-lifecycle.log'), 'utf8'))
    .toEqual(expect.stringContaining('before_switch'))
  const importedLifecycle = await readFile(resolve(projectRoot, 'fork-lifecycle.log'), 'utf8')
  expect(importedLifecycle).toContain('shutdown:resume')
  expect(importedLifecycle).toContain('start:resume')

  expect(await startSelectedRun('/project-note')).toMatchObject({ ok: true })
  await expect
    .poll(() => readFile(authoritativeJsonlPath, 'utf8'))
    .toContain('Project Extension loaded')

  await window.getByRole('button', { name: 'Session Controls' }).click()
  await window.getByLabel('Model').fill('pictor-session-model')
  await window.getByLabel('Thinking Level').selectOption('high')
  await window.getByLabel('Steering').selectOption('all')
  await window.getByRole('button', { name: '保存' }).click()
  await expect(window.getByRole('dialog', { name: 'Session Controls' })).toBeHidden()
  const metadataAfterControls = JSON.parse(await readFile(imported.path, 'utf8')) as {
    history: { runtimePreferences?: Record<string, unknown> }
  }
  expect(metadataAfterControls.history.runtimePreferences).toMatchObject({
    modelId: 'pictor-session-model',
    thinkingLevel: 'high',
    steeringMode: 'all',
    followUpMode: 'one-at-a-time',
    activeTools: expect.arrayContaining(['read', 'write', 'edit', 'bash']),
  })

  await window.getByRole('button', { name: 'Session Controls' }).click()
  await window.getByRole('button', { name: '重新加载资源' }).click()
  await expect(window.getByText('Runtime 资源已重载')).toBeVisible()
  await window.getByText('Runtime 资源已重载').click()
  const authoritativeJsonlBeforeExport = await readFile(authoritativeJsonlPath, 'utf8')

  const exportSelectedSession = (format: 'jsonl' | 'html') =>
    invokeAgentWorkspace(window, 'exportSession', { sessionId: imported.sessionId, format })
  await electronApp.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' })
  })
  expect(await exportSelectedSession('jsonl')).toEqual({ ok: true, value: false })

  const exportedJsonlPath = testInfo.outputPath('exported-current-branch.jsonl')
  await electronApp.evaluate(({ dialog }, outputPath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: outputPath })
  }, exportedJsonlPath)
  expect(await exportSelectedSession('jsonl')).toEqual({ ok: true, value: true })
  await expect
    .poll(() => readFile(exportedJsonlPath, 'utf8').catch(() => ''))
    .toContain('Imported branch answer')
  const exportedJsonl = await readFile(exportedJsonlPath, 'utf8')
  expect(exportedJsonl).toContain('Imported branch task')
  expect(exportedJsonl).not.toContain('Imported original answer')

  const exportedHtmlPath = testInfo.outputPath('exported-complete-tree.html')
  await electronApp.evaluate(({ dialog }, outputPath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: outputPath })
  }, exportedHtmlPath)
  expect(await exportSelectedSession('html')).toEqual({ ok: true, value: true })
  await expect
    .poll(() => readFile(exportedHtmlPath, 'utf8').catch(() => ''))
    .toContain('<!DOCTYPE html>')
  const exportedHtml = await readFile(exportedHtmlPath, 'utf8')
  const encodedSessionData = exportedHtml.match(
    /<script id="session-data" type="application\/json">([^<]+)<\/script>/,
  )?.[1]
  expect(encodedSessionData).toBeTruthy()
  const exportedTree = Buffer.from(encodedSessionData!, 'base64').toString('utf8')
  expect(exportedTree).toContain('Imported original answer')
  expect(exportedTree).toContain('Imported branch answer')
  expect(await readFile(importSource, 'utf8')).toBe(importedJsonl)
  expect(await readFile(authoritativeJsonlPath, 'utf8')).toBe(authoritativeJsonlBeforeExport)
})
