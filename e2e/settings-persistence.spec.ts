import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import type { PictorBridge } from '../src/shared/desktop-bridge.js'
import { credentialFixtures } from './support.js'

test('isolates model credentials and restores non-secret settings', async ({
  browserName: _browserName,
}, testInfo) => {
  const userDataDirectory = testInfo.outputPath('user-data')
  const launch = () =>
    electron.launch({
      args: [resolve('out/main/index.js'), `--user-data-dir=${userDataDirectory}`],
      cwd: resolve('.'),
    })

  const firstApp = await launch()
  const firstWindow = await firstApp.firstWindow()
  await firstWindow.waitForLoadState('domcontentloaded')
  const saved = await firstWindow.evaluate(
    (apiKey) =>
      (globalThis as typeof globalThis & { pictor: PictorBridge }).pictor.saveSettings({
        apiProtocol: 'responses',
        baseUrl: 'https://api.example.test/v1',
        modelId: 'model-e2e',
        reasoningEffort: 'xhigh',
        temperature: 0.3,
        maxOutputTokens: 4096,
        apiKey: { action: 'replace', value: apiKey },
      }),
    credentialFixtures.storedSettings,
  )
  expect(saved).toEqual({
    ok: true,
    value: {
      apiProtocol: 'responses',
      baseUrl: 'https://api.example.test/v1',
      modelId: 'model-e2e',
      reasoningEffort: 'xhigh',
      temperature: 0.3,
      maxOutputTokens: 4096,
      hasApiKey: true,
    },
  })
  await firstApp.close()

  const dataDirectory = join(userDataDirectory, 'data-v1')
  const stateText = await readFile(join(dataDirectory, 'state.json'), 'utf8')
  const auth = JSON.parse(await readFile(join(dataDirectory, 'auth.json'), 'utf8')) as {
    apiKey: string | null
  }
  expect(stateText).not.toContain(credentialFixtures.storedSettings)
  expect(auth).toEqual({ apiKey: credentialFixtures.storedSettings })

  const legacySessionPath = join(dataDirectory, 'sessions', 'legacy-fixture.json')
  const legacyTranscriptPath = join(
    dataDirectory,
    'pi',
    'legacy-project',
    'legacy-session',
    'legacy-fixture.jsonl',
  )
  await mkdir(join(dataDirectory, 'sessions'), { recursive: true })
  await mkdir(join(dataDirectory, 'pi', 'legacy-project', 'legacy-session'), { recursive: true })
  const legacyProjectId = '01234567-89ab-4def-8123-456789abcdef'
  const legacySessionId = '11234567-89ab-4def-8123-456789abcdef'
  const legacyMessageId = '21234567-89ab-4def-8123-456789abcdef'
  const legacyTimestamp = '2026-08-11T00:00:00.000Z'
  await writeFile(
    legacySessionPath,
    `${JSON.stringify({
      schemaVersion: 1,
      id: legacySessionId,
      projectId: legacyProjectId,
      title: `legacy ${credentialFixtures.storedSettings} keep`,
      messages: [
        {
          id: legacyMessageId,
          role: 'user',
          content: 'unrelated session content',
          status: 'completed',
          createdAt: legacyTimestamp,
          updatedAt: legacyTimestamp,
        },
      ],
      runs: [],
      createdAt: legacyTimestamp,
      updatedAt: legacyTimestamp,
    })}\n`,
  )
  await writeFile(
    legacyTranscriptPath,
    [
      JSON.stringify({
        type: 'session',
        version: 3,
        id: legacySessionId,
        timestamp: legacyTimestamp,
        cwd: 'C:\\legacy-project',
      }),
      JSON.stringify({
        type: 'message',
        id: 'legacy-entry',
        parentId: null,
        timestamp: legacyTimestamp,
        message: {
          role: 'toolResult',
          toolCallId: 'legacy-call',
          toolName: 'pictor_read',
          content: [{ type: 'text', text: `tool ${credentialFixtures.storedSettings}` }],
          details: { note: 'unrelated transcript content' },
          isError: false,
          timestamp: Date.parse(legacyTimestamp),
        },
      }),
      '',
    ].join('\n'),
  )

  const restoredApp = await launch()
  try {
    const restoredWindow = await restoredApp.firstWindow()
    await restoredWindow.waitForLoadState('domcontentloaded')
    const snapshot = await restoredWindow.evaluate(() =>
      (globalThis as typeof globalThis & { pictor: PictorBridge }).pictor.getSnapshot(),
    )
    expect(snapshot).toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({
          settings: {
            apiProtocol: 'responses',
            baseUrl: 'https://api.example.test/v1',
            modelId: 'model-e2e',
            reasoningEffort: 'xhigh',
            temperature: 0.3,
            maxOutputTokens: 4096,
            hasApiKey: true,
          },
        }),
      }),
    )
    const migratedText = await Promise.all([
      readFile(legacySessionPath, 'utf8'),
      readFile(legacyTranscriptPath, 'utf8'),
    ])
    expect(migratedText.join('\n')).not.toContain(credentialFixtures.storedSettings)
    expect(migratedText[0]).toContain('legacy [REDACTED] keep')
    expect(migratedText[0]).toContain('unrelated session content')
    expect(migratedText[1]).toContain('unrelated transcript content')
  } finally {
    await restoredApp.close()
  }
})
