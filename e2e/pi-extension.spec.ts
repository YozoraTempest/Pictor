import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'

import type { PictorBridge } from '../src/shared/desktop-bridge.js'
import { defaultPluginProfile } from '../src/main/plugins/default-profile.js'
import { PluginStore } from '../src/main/plugins/plugin-store.js'
import { credentialFixtures } from './support.js'

test('loads an unmodified native Pi Extension from the user Store', async ({
  browserName: _browserName,
}, testInfo) => {
  let requestCount = 0
  const server = createServer(async (request, response) => {
    for await (const chunk of request) void chunk
    requestCount += 1
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    if (requestCount === 1 || requestCount === 3) {
      const toolName = requestCount === 1 ? 'hello' : 'ask_gui'
      const callId = requestCount === 1 ? 'call-native-hello' : 'call-extension-ui'
      const toolArguments = requestCount === 1 ? { name: 'Pictor' } : {}
      response.write(
        `data: ${JSON.stringify({
          id: 'chatcmpl-extension-tool',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'pictor-e2e-model',
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [
                  {
                    index: 0,
                    id: callId,
                    type: 'function',
                    function: { name: toolName, arguments: JSON.stringify(toolArguments) },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        })}\n\n`,
      )
      response.write(
        `data: ${JSON.stringify({
          id: 'chatcmpl-extension-tool',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'pictor-e2e-model',
          choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
        })}\n\n`,
      )
    } else {
      response.write(
        `data: ${JSON.stringify({
          id: 'chatcmpl-extension-result',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'pictor-e2e-model',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: 'Native extension completed.' },
              finish_reason: null,
            },
          ],
        })}\n\n`,
      )
      response.write(
        `data: ${JSON.stringify({
          id: 'chatcmpl-extension-result',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'pictor-e2e-model',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        })}\n\n`,
      )
    }
    response.end('data: [DONE]\n\n')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('E2E model server failed to bind')

  const userDataDirectory = testInfo.outputPath('pi-extension-user-data')
  const projectRoot = testInfo.outputPath('pi-extension-project')
  await mkdir(projectRoot, { recursive: true })
  const projectExtensionDirectory = resolve(projectRoot, '.pi', 'extensions')
  await mkdir(projectExtensionDirectory, { recursive: true })
  await writeFile(
    resolve(projectExtensionDirectory, 'project-note.ts'),
    `export default function (pi) {
  pi.registerCommand('project-note', {
    description: 'Project Extension command',
    handler: async () => pi.sendMessage({ customType: 'project-note', content: 'Project Extension loaded', display: true, details: {} }),
  })
}
`,
  )
  const imageFixture = testInfo.outputPath('fixture.png')
  await writeFile(
    imageFixture,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z6i0AAAAASUVORK5CYII=',
      'base64',
    ),
  )
  const importSource = testInfo.outputPath('import-source.jsonl')
  const importedAssistantMessage = (content: string) => ({
    role: 'assistant',
    content: [{ type: 'text', text: content }],
    api: 'openai-completions',
    provider: 'pictor-openai-compatible',
    model: 'pictor-e2e-model',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
  })
  const importedJsonl = [
    JSON.stringify({
      type: 'session',
      version: 3,
      id: 'imported-pi-session',
      timestamp: new Date().toISOString(),
      cwd: '/missing/import-project',
    }),
    JSON.stringify({
      type: 'message',
      id: 'imported-user',
      parentId: null,
      timestamp: new Date().toISOString(),
      message: { role: 'user', content: 'Imported root task' },
    }),
    JSON.stringify({
      type: 'custom_message',
      id: 'imported-large-context',
      parentId: 'imported-user',
      timestamp: new Date().toISOString(),
      customType: 'e2e-large-context',
      content: 'context '.repeat(12_000),
      display: false,
    }),
    JSON.stringify({
      type: 'message',
      id: 'imported-original',
      parentId: 'imported-large-context',
      timestamp: new Date().toISOString(),
      message: importedAssistantMessage('Imported original answer'),
    }),
    JSON.stringify({
      type: 'message',
      id: 'imported-branch-user',
      parentId: 'imported-large-context',
      timestamp: new Date().toISOString(),
      message: { role: 'user', content: 'Imported branch task' },
    }),
    JSON.stringify({
      type: 'message',
      id: 'imported-branch-answer',
      parentId: 'imported-branch-user',
      timestamp: new Date().toISOString(),
      message: importedAssistantMessage('Imported branch answer'),
    }),
    '',
  ].join('\n')
  await writeFile(importSource, importedJsonl)
  const store = new PluginStore({
    userDataDirectory,
    bundledPluginsDirectory: resolve('.pictor/bundled-plugins'),
    profile: defaultPluginProfile,
  })
  await store.initialize()
  await store.installPiExtension(
    resolve('node_modules/@earendil-works/pi-coding-agent/examples/extensions/hello.ts'),
  )
  const guiExtension = testInfo.outputPath('gui-extension.ts')
  await writeFile(
    guiExtension,
    `import { Type } from 'typebox'
export default function (pi) {
  pi.registerTool({
    name: 'ask_gui',
    label: 'Ask GUI',
    description: 'Ask through the Pictor GUI',
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _update, ctx) {
      const value = await ctx.ui.input('Enter a value', 'type something...')
      await new Promise((resolve) => setTimeout(resolve, 1_000))
      return { content: [{ type: 'text', text: String(value ?? 'cancelled') }], details: {} }
    },
  })
}
`,
  )
  await store.installPiExtension(guiExtension)
  const lifecycleExtension = testInfo.outputPath('fork-lifecycle-extension.ts')
  await writeFile(
    lifecycleExtension,
    `import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
export default function (pi) {
  pi.registerCommand('e2e-note', {
    description: 'Append a visible Extension note',
    handler: async (args) => {
      pi.sendMessage({ customType: 'e2e-note', content: 'Extension note: ' + args, display: true, details: {} })
      pi.appendEntry('e2e-command-state', { args })
    },
  })
  pi.registerCommand('e2e-user', {
    description: 'Send a User Message from an Extension',
    handler: async () => pi.sendUserMessage('Extension-originated user message'),
  })
  const record = (ctx, value) => appendFileSync(join(ctx.cwd, 'fork-lifecycle.log'), value + '\\n')
  pi.on('session_before_fork', (event, ctx) => record(ctx, 'before_fork:' + event.entryId + ':' + event.position))
  pi.on('session_before_switch', (_event, ctx) => record(ctx, 'before_switch'))
  pi.on('session_before_tree', (event, ctx) => {
    record(ctx, 'before_tree:' + event.preparation.targetId + ':' + event.preparation.oldLeafId + ':' + (event.preparation.customInstructions || ''))
    if (event.preparation.userWantsSummary) return { summary: { summary: 'E2E branch summary' } }
  })
  pi.on('session_tree', (event, ctx) => record(ctx, 'tree:' + event.oldLeafId + ':' + event.newLeafId))
  pi.on('session_before_compact', (event, ctx) => {
    record(ctx, 'before_compact:' + event.reason + ':' + (event.customInstructions || ''))
    if (event.customInstructions === 'Cancel E2E compaction') return { cancel: true }
    return { compaction: { summary: 'E2E compacted context', firstKeptEntryId: event.preparation.firstKeptEntryId, tokensBefore: event.preparation.tokensBefore } }
  })
  pi.on('session_compact', (event, ctx) => record(ctx, 'compact:' + event.reason + ':' + event.compactionEntry.summary))
  pi.on('session_shutdown', (event, ctx) => record(ctx, 'shutdown:' + event.reason))
  pi.on('session_start', (event, ctx) => record(ctx, 'start:' + event.reason))
}
`,
  )
  await store.installPiExtension(lifecycleExtension)

  const electronApp = await electron.launch({
    args: [resolve('out/main/index.js'), `--user-data-dir=${userDataDirectory}`],
    cwd: resolve('.'),
  })
  try {
    const window = await electronApp.firstWindow()
    await expect(window.getByRole('heading', { name: '选择一个项目开始' })).toBeVisible()
    const setup = await window.evaluate(
      async ({ apiKey, baseUrl, rootPath }) => {
        const bridge = (globalThis as typeof globalThis & { pictor: PictorBridge }).pictor
        const settings = await bridge.saveSettings({
          apiProtocol: 'chat-completions',
          baseUrl,
          modelId: 'pictor-e2e-model',
          reasoningEffort: null,
          temperature: null,
          maxOutputTokens: null,
          apiKey: { action: 'replace', value: apiKey },
        })
        const project = await bridge.registerProject({ rootPath, trusted: true })
        if (!project.ok) return { settings, project, session: null }
        const session = await bridge.createSession({ projectId: project.value.id })
        return { settings, project, session }
      },
      {
        apiKey: credentialFixtures.localRuntime,
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        rootPath: projectRoot,
      },
    )
    expect(setup).toMatchObject({
      settings: { ok: true },
      project: { ok: true },
      session: { ok: true },
    })
    await window.reload()
    const startSelectedRun = (prompt: string) =>
      window.evaluate(async (value) => {
        const bridge = (globalThis as typeof globalThis & { pictor: PictorBridge }).pictor
        const snapshot = await bridge.getSnapshot()
        if (!snapshot.ok || !snapshot.value.selectedSessionId) return null
        return bridge.startRun({ sessionId: snapshot.value.selectedSessionId, prompt: value })
      }, prompt)
    expect(await startSelectedRun('Use the hello tool.')).toMatchObject({ ok: true })

    await expect(window.getByText('Extension Tool')).toBeVisible({ timeout: 30_000 })
    await window.getByText('查看输出').click()
    await expect(window.getByText('Hello, Pictor!')).toBeVisible({ timeout: 30_000 })
    await expect(window.getByText('Native extension completed.')).toBeVisible({ timeout: 30_000 })
    await expect(window.getByText('已完成').last()).toBeVisible({ timeout: 30_000 })

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

    await window.getByRole('button', { name: 'Session Tree' }).click()
    const tree = window.getByRole('complementary', { name: 'Session Tree' })
    const historicalReply = tree
      .getByRole('button', { name: 'Native extension completed.' })
      .first()
    await historicalReply.click()
    await expect(window.getByText(/正在查看历史分支/)).toBeVisible()
    await tree.getByRole('button', { name: 'Fork 为新 Session' }).click()

    await expect(window.getByRole('heading', { name: 'Use the hello tool. (Fork)' })).toBeVisible({
      timeout: 30_000,
    })
    await expect(window.locator('.timeline').getByText('Native extension completed.')).toBeVisible()
    const forkedSnapshot = await window.evaluate(async () => {
      const bridge = (globalThis as typeof globalThis & { pictor: PictorBridge }).pictor
      return bridge.getSnapshot()
    })
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
    const cloneButton = forkTree.getByRole('button', {
      name: 'Clone 当前分支为新 Session',
    })
    await expect(cloneButton).toBeEnabled()
    await cloneButton.click()

    await expect(
      window.getByRole('heading', { name: 'Use the hello tool. (Fork) (Clone)' }),
    ).toBeVisible({ timeout: 30_000 })
    await expect(window.locator('.timeline').getByText('Native extension completed.')).toBeVisible()
    const clonedSnapshot = await window.evaluate(async () => {
      const bridge = (globalThis as typeof globalThis & { pictor: PictorBridge }).pictor
      return bridge.getSnapshot()
    })
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

    await electronApp.evaluate(({ dialog }, sourcePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [sourcePath] })
    }, importSource)
    await window.getByLabel('pi-extension-project 项目操作').click()
    await window.getByRole('button', { name: '导入 Pi Session' }).click()

    await expect(window.getByRole('heading', { name: 'import-source (Import)' })).toBeVisible({
      timeout: 30_000,
    })
    await expect(window.locator('.timeline').getByText('Imported branch answer')).toBeVisible()
    await window.getByRole('button', { name: 'Session Tree' }).click()
    const importedTree = window.getByRole('complementary', { name: 'Session Tree' })
    await expect(
      importedTree.getByRole('button', { name: 'Imported original answer' }),
    ).toBeVisible()
    await expect(importedTree.getByRole('button', { name: 'Imported branch answer' })).toBeVisible()
    await importedTree.getByRole('button', { name: 'Imported root task' }).click()
    await window.getByRole('button', { name: '标记节点' }).click()
    await window.getByLabel('Label').fill('root-checkpoint')
    await window.getByRole('button', { name: '保存' }).click()
    await expect(
      importedTree.getByRole('button', { name: 'root-checkpoint', exact: true }),
    ).toBeVisible()
    const importedSnapshot = await window.evaluate(async () => {
      const bridge = (globalThis as typeof globalThis & { pictor: PictorBridge }).pictor
      return bridge.getSnapshot()
    })
    expect(importedSnapshot).toMatchObject({
      ok: true,
      value: {
        selectedSessionId: expect.any(String),
        sessions: expect.arrayContaining([
          expect.objectContaining({ title: 'import-source (Import)' }),
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
    const importedSessionId = importedSnapshot.ok ? importedSnapshot.value.selectedSessionId : null
    const importedSummary = importedSnapshot.ok
      ? importedSnapshot.value.sessions.find((session) => session.id === importedSessionId)
      : null
    if (!importedSessionId || !importedSummary) {
      throw new Error('Imported Pictor Session is not selected')
    }
    const importedMetadataPath = resolve(
      userDataDirectory,
      'data-v1',
      'sessions',
      `${importedSessionId}.json`,
    )
    const metadataBeforeNavigation = JSON.parse(await readFile(importedMetadataPath, 'utf8')) as {
      history: { piSessionPath: string; activeLeafId?: string | null }
    }
    const authoritativeJsonlPath = metadataBeforeNavigation.history.piSessionPath
    expect(await startSelectedRun('/project-note')).toMatchObject({ ok: true })
    await expect
      .poll(() => readFile(authoritativeJsonlPath, 'utf8'), { timeout: 30_000 })
      .toContain('Project Extension loaded')

    await window.getByRole('button', { name: 'Session Controls' }).click()
    await window.getByLabel('Model').fill('pictor-session-model')
    await window.getByLabel('Thinking Level').selectOption('high')
    await window.getByLabel('Steering').selectOption('all')
    await window.getByRole('button', { name: '保存' }).click()
    await expect(window.getByRole('dialog', { name: 'Session Controls' })).toBeHidden()
    const metadataAfterControls = JSON.parse(await readFile(importedMetadataPath, 'utf8')) as {
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
      window.evaluate(async (selectedFormat) => {
        const bridge = (globalThis as typeof globalThis & { pictor: PictorBridge }).pictor
        const snapshot = await bridge.getSnapshot()
        if (!snapshot.ok || !snapshot.value.selectedSessionId) return snapshot
        return bridge.exportSession({
          sessionId: snapshot.value.selectedSessionId,
          format: selectedFormat,
        })
      }, format)
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

    const historyBeforeNavigation = await window.evaluate(async (sessionId) => {
      const bridge = (globalThis as typeof globalThis & { pictor: PictorBridge }).pictor
      return bridge.inspectSessionHistory({ sessionId, entryId: null })
    }, importedSessionId)
    if (!historyBeforeNavigation.ok || !historyBeforeNavigation.value.tree?.activeLeafId) {
      throw new Error('Imported Pi Session does not have an active leaf')
    }
    const activeLeafBeforeNavigation = historyBeforeNavigation.value.tree.activeLeafId
    await window.getByRole('button', { name: 'Session Tree', exact: true }).click()
    await window.getByRole('button', { name: 'Session Tree', exact: true }).click()
    const navigationTree = window.getByRole('complementary', { name: 'Session Tree' })
    await navigationTree.getByRole('button', { name: 'Imported original answer' }).click()
    await expect(window.getByRole('button', { name: '切换到此节点', exact: true })).toBeEnabled()
    await window.getByRole('button', { name: '切换到此节点', exact: true }).click()

    const timeline = window.locator('.timeline')
    await expect(timeline.getByText('Imported original answer')).toBeVisible()
    await expect(timeline.getByText('Imported branch answer')).toHaveCount(0)
    await expect(window.getByRole('textbox', { name: '任务描述' })).toBeEnabled()
    const navigatedHistory = await window.evaluate(async () => {
      const bridge = (globalThis as typeof globalThis & { pictor: PictorBridge }).pictor
      const snapshot = await bridge.getSnapshot()
      if (!snapshot.ok || !snapshot.value.selectedSessionId) return snapshot
      return bridge.inspectSessionHistory({
        sessionId: snapshot.value.selectedSessionId,
        entryId: null,
      })
    })
    expect(navigatedHistory).toMatchObject({
      ok: true,
      value: {
        tree: { activeLeafId: 'imported-original', selectedEntryId: 'imported-original' },
      },
    })
    const metadataAfterNavigation = JSON.parse(await readFile(importedMetadataPath, 'utf8')) as {
      history: { piSessionPath: string; activeLeafId?: string | null }
    }
    expect(metadataAfterNavigation.history).toMatchObject({
      piSessionPath: metadataBeforeNavigation.history.piSessionPath,
      activeLeafId: 'imported-original',
    })
    await expect
      .poll(() => readFile(resolve(projectRoot, 'fork-lifecycle.log'), 'utf8'))
      .toEqual(
        expect.stringContaining(`before_tree:imported-original:${activeLeafBeforeNavigation}`),
      )
    const treeLifecycle = await readFile(resolve(projectRoot, 'fork-lifecycle.log'), 'utf8')
    expect(treeLifecycle).toContain(`tree:${activeLeafBeforeNavigation}:imported-original`)

    await window.evaluate((sessionId) => {
      const target = globalThis as typeof globalThis & {
        pictor: PictorBridge
        __pictorNavigationEvents?: unknown[]
      }
      target.__pictorNavigationEvents = []
      target.pictor.onRuntimeEvent((event) => {
        if (event.sessionId === sessionId) target.__pictorNavigationEvents?.push(event)
      })
    }, importedSessionId)
    expect(await startSelectedRun('Continue from the historical answer.')).toMatchObject({
      ok: true,
    })
    await expect
      .poll(
        () =>
          window.evaluate(() => {
            const events = (
              globalThis as typeof globalThis & {
                __pictorNavigationEvents?: Array<Record<string, unknown>>
              }
            ).__pictorNavigationEvents
            return (
              events?.find(
                (event) =>
                  event.type === 'run.stateChanged' &&
                  ['completed', 'failed', 'stopped', 'interrupted'].includes(String(event.status)),
              ) ?? null
            )
          }),
        { timeout: 30_000 },
      )
      .not.toBeNull()
    const navigationRunEvents = await window.evaluate(
      () =>
        (
          globalThis as typeof globalThis & {
            __pictorNavigationEvents?: Array<Record<string, unknown>>
          }
        ).__pictorNavigationEvents ?? [],
    )
    expect(navigationRunEvents.filter((event) => event.type === 'runtime.error')).toEqual([])
    await expect
      .poll(() => readFile(authoritativeJsonlPath, 'utf8'), { timeout: 30_000 })
      .toContain('Continue from the historical answer.')
    await expect(timeline.getByText('Native extension completed.')).toBeVisible({
      timeout: 30_000,
    })
    await expect(timeline.getByText('Continue from the historical answer.')).toBeVisible()
    await expect(
      window.locator('.workspace-header').getByText(/pictor-session-model/),
    ).toBeVisible()
    await expect(timeline.getByText('Imported branch answer')).toHaveCount(0)
    const metadataAfterRun = JSON.parse(await readFile(importedMetadataPath, 'utf8')) as {
      history: { piSessionPath: string; activeLeafId?: string | null }
    }
    expect(metadataAfterRun.history.piSessionPath).toBe(
      metadataBeforeNavigation.history.piSessionPath,
    )
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

    const cancelledCompaction = await window.evaluate(async (sessionId) => {
      const bridge = (globalThis as typeof globalThis & { pictor: PictorBridge }).pictor
      return bridge.compactSession({
        sessionId,
        customInstructions: 'Cancel E2E compaction',
      })
    }, importedSessionId)
    expect(cancelledCompaction).toEqual({ ok: true, value: null })

    await window.getByRole('button', { name: '压缩上下文' }).click()
    await window.getByLabel('自定义摘要指令（可选）').fill('Preserve E2E decisions')
    await window.getByRole('button', { name: '开始压缩' }).click()
    await expect(timeline.getByText('E2E compacted context')).toBeVisible({ timeout: 30_000 })
    const compactedTree = window.getByRole('complementary', { name: 'Session Tree' })
    await expect(compactedTree).toBeVisible()
    await expect(compactedTree.getByRole('button', { name: 'Compaction summary' })).toBeVisible()
    const compactionLifecycle = await readFile(resolve(projectRoot, 'fork-lifecycle.log'), 'utf8')
    expect(compactionLifecycle).toContain('before_compact:manual:Cancel E2E compaction')
    expect(compactionLifecycle).toContain('before_compact:manual:Preserve E2E decisions')
    expect(compactionLifecycle).toContain('compact:manual:E2E compacted context')

    expect(await startSelectedRun('Continue after compaction.')).toMatchObject({ ok: true })
    await expect
      .poll(() => readFile(authoritativeJsonlPath, 'utf8'), { timeout: 30_000 })
      .toContain('Continue after compaction.')

    await expect(window.getByRole('button', { name: '发送任务' })).toHaveAttribute(
      'title',
      '发送任务',
      { timeout: 30_000 },
    )
    await electronApp.evaluate(({ dialog }, imagePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [imagePath] })
    }, imageFixture)
    await window.getByRole('button', { name: '添加图片' }).click()
    await expect(window.getByAltText('fixture.png')).toBeVisible()
    await window.getByRole('textbox', { name: '任务描述' }).fill('Inspect the attached image.')
    await window.getByRole('button', { name: '发送任务' }).click()
    await expect
      .poll(() => readFile(authoritativeJsonlPath, 'utf8'), { timeout: 30_000 })
      .toContain('"type":"image"')

    await expect(window.getByRole('button', { name: '发送任务' })).toHaveAttribute(
      'title',
      '发送任务',
      { timeout: 30_000 },
    )
    expect(await startSelectedRun('/e2e-note hello')).toMatchObject({ ok: true })
    await expect
      .poll(() => readFile(authoritativeJsonlPath, 'utf8'), { timeout: 30_000 })
      .toContain('Extension note: hello')
    await expect(timeline.getByText('Extension note: hello')).toBeVisible({ timeout: 30_000 })
    expect(await readFile(authoritativeJsonlPath, 'utf8')).toContain('e2e-command-state')

    await window.evaluate(() => {
      const target = globalThis as typeof globalThis & {
        __pictorNavigationEvents?: unknown[]
      }
      target.__pictorNavigationEvents = []
    })
    expect(await startSelectedRun('/e2e-user')).toMatchObject({ ok: true })
    await expect
      .poll(() => readFile(authoritativeJsonlPath, 'utf8'), { timeout: 30_000 })
      .toContain('Extension-originated user message')
    await expect
      .poll(() =>
        window.evaluate(() => {
          const events = (
            globalThis as typeof globalThis & {
              __pictorNavigationEvents?: Array<Record<string, unknown>>
            }
          ).__pictorNavigationEvents
          return (
            events?.filter(
              (event) =>
                event.type === 'run.stateChanged' &&
                ['completed', 'failed', 'stopped', 'interrupted'].includes(String(event.status)),
            ).length ?? 0
          )
        }),
      )
      .toBe(1)

    expect(await startSelectedRun('/project-note')).toMatchObject({ ok: true })
    await expect
      .poll(() => readFile(authoritativeJsonlPath, 'utf8'), { timeout: 30_000 })
      .toContain('Project Extension loaded')
  } finally {
    await electronApp.close()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})
