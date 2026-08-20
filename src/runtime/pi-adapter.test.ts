// @vitest-environment node

import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  RuntimeEvent,
  RuntimeExportConfig,
  RuntimeForkConfig,
  RuntimeImportConfig,
  RuntimeStartConfig,
} from '../shared/runtime-protocol.js'
import { REDACTED_SECRET } from '../shared/secret-redaction.js'
import { PiAgentRuntime } from './pi-adapter.js'

const sessionFactory = async () => ({
  subscribe: () => () => undefined,
  prompt: async () => undefined,
  abort: async () => undefined,
  waitForIdle: async () => undefined,
  steer: async () => undefined,
  followUp: async () => undefined,
  clearQueue: () => ({ steering: [], followUp: [] }),
  fork: async () => ({ cancelled: false }),
  importFromJsonl: async () => ({ cancelled: false }),
  exportToHtml: async (outputPath: string) => outputPath,
  exportToJsonl: (outputPath: string) => outputPath,
  getSessionStats: () => ({
    sessionFile: undefined,
    sessionId: 'test-session',
    userMessages: 0,
    assistantMessages: 0,
    toolCalls: 0,
    toolResults: 0,
    totalMessages: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
  }),
  getSessionId: () => 'test-pi-session',
  getSessionFile: () => '/tmp/test-pi-session.jsonl',
  dispose: () => undefined,
})

describe('PiAgentRuntime cleanup', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pictor-runtime-cleanup-'))
    await mkdir(join(root, 'project'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it.each(['a', 'id', 'running'])(
    'releases the runtime after initial event emission fails for short key %s',
    async (secret) => {
      const events: RuntimeEvent[] = []
      let rejectNextEvent = true
      const runtime = new PiAgentRuntime((event) => {
        if (rejectNextEvent) {
          rejectNextEvent = false
          throw new Error(`Event emission failed with ${secret}`)
        }
        events.push(event)
      }, sessionFactory)
      runtime.configure({
        extensionPaths: [],
        skillPaths: [],
        promptPaths: [],
        modelProviders: [
          {
            id: 'test-model-provider',
            register: () => {
              throw new Error('not used by the test Session factory')
            },
          },
        ],
      })
      const baseConfig = {
        type: 'start',
        sessionId: '11234567-89ab-4def-8123-456789abcdef',
        messageId: '21234567-89ab-4def-8123-456789abcdef',
        projectRoot: join(root, 'project'),
        agentDirectory: join(root, 'agent'),
        sessionDirectory: join(root, 'session'),
        resumeSession: false,
        settings: {
          apiProtocol: 'responses',
          baseUrl: 'https://example.test/v1',
          modelId: 'test-model',
          reasoningEffort: null,
          temperature: null,
          maxOutputTokens: 64,
        },
        apiKey: secret,
        prompt: `prompt ${secret}`,
      } satisfies Omit<RuntimeStartConfig, 'runId'>

      await runtime.start({
        ...baseConfig,
        runId: '01234567-89ab-4def-8123-456789abcdef',
      })

      expect(events.at(-1)).toMatchObject({
        type: 'run.stateChanged',
        runId: '01234567-89ab-4def-8123-456789abcdef',
        status: 'failed',
      })
      const runtimeError = events.find(
        (event): event is Extract<RuntimeEvent, { type: 'runtime.error' }> =>
          event.type === 'runtime.error',
      )
      const failedEvent = events.find(
        (event): event is Extract<RuntimeEvent, { type: 'run.stateChanged' }> =>
          event.type === 'run.stateChanged' && event.status === 'failed',
      )
      expect(runtimeError?.message).toContain(REDACTED_SECRET)
      expect(runtimeError?.message).not.toContain(secret)
      expect(failedEvent?.error).not.toContain(secret)

      await runtime.start({
        ...baseConfig,
        runId: '31234567-89ab-4def-8123-456789abcdef',
      })

      expect(events.at(-1)).toMatchObject({
        type: 'run.stateChanged',
        runId: '31234567-89ab-4def-8123-456789abcdef',
        status: 'completed',
      })
    },
  )

  it('delegates steering, follow-up, and queue clearing to the active Pi Session', async () => {
    let finishIdle: (() => void) | undefined
    const prompt = vi.fn(async () => undefined)
    const steer = vi.fn(async () => undefined)
    const followUp = vi.fn(async () => undefined)
    const clearQueue = vi.fn(() => ({ steering: [], followUp: [] }))
    const waitForIdle = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishIdle = resolve
        }),
    )
    const runtime = new PiAgentRuntime(
      () => undefined,
      async () => ({
        subscribe: () => () => undefined,
        prompt,
        steer,
        followUp,
        clearQueue,
        fork: async () => ({ cancelled: false }),
        importFromJsonl: async () => ({ cancelled: false }),
        exportToHtml: async (outputPath: string) => outputPath,
        exportToJsonl: (outputPath: string) => outputPath,
        abort: async () => undefined,
        waitForIdle,
        dispose: () => undefined,
        getSessionStats: () => ({
          sessionFile: undefined,
          sessionId: 'test-session',
          userMessages: 0,
          assistantMessages: 0,
          toolCalls: 0,
          toolResults: 0,
          totalMessages: 0,
          tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          cost: 0,
        }),
        getSessionId: () => 'test-pi-session',
        getSessionFile: () => '/tmp/test-pi-session.jsonl',
      }),
    )
    runtime.configure({
      extensionPaths: [],
      skillPaths: [],
      promptPaths: [],
      modelProviders: [
        {
          id: 'test-model-provider',
          register: () => {
            throw new Error('not used by the test Session factory')
          },
        },
      ],
    })
    const runId = '71234567-89ab-4def-8123-456789abcdef'
    const running = runtime.start({
      type: 'start',
      runId,
      sessionId: '81234567-89ab-4def-8123-456789abcdef',
      messageId: '91234567-89ab-4def-8123-456789abcdef',
      projectRoot: join(root, 'project'),
      agentDirectory: join(root, 'agent-queue'),
      sessionDirectory: join(root, 'session-queue'),
      resumeSession: false,
      settings: {
        apiProtocol: 'responses',
        baseUrl: 'https://example.test/v1',
        modelId: 'test-model',
        reasoningEffort: null,
        temperature: null,
        maxOutputTokens: 64,
      },
      apiKey: 'test-key',
      prompt: 'start',
    })
    await vi.waitFor(() => expect(prompt).toHaveBeenCalled())

    await runtime.queueMessage(runId, 'steer', 'redirect')
    await runtime.queueMessage(runId, 'follow-up', 'continue')
    runtime.clearQueue(runId)

    expect(steer).toHaveBeenCalledWith('redirect')
    expect(followUp).toHaveBeenCalledWith('continue')
    expect(clearQueue).toHaveBeenCalledOnce()
    finishIdle?.()
    await running
  })

  it('forks through the native Pi Session lifecycle and moves the new JSONL', async () => {
    const sourceSessionDirectory = join(root, 'source-session')
    const targetSessionDirectory = join(root, 'target-session')
    await mkdir(sourceSessionDirectory)
    const sourceFile = join(sourceSessionDirectory, 'source.jsonl')
    const forkedFile = join(sourceSessionDirectory, 'forked.jsonl')
    await writeFile(sourceFile, '{"type":"session","id":"source"}\n')
    let currentFile = sourceFile
    let currentId = 'source-pi-session'
    const nativeFork = vi.fn(async () => {
      await writeFile(forkedFile, '{"type":"session","id":"forked"}\n')
      currentFile = forkedFile
      currentId = 'forked-pi-session'
      return { cancelled: false }
    })
    const dispose = vi.fn(async () => undefined)
    const runtime = new PiAgentRuntime(
      () => undefined,
      async () => ({
        subscribe: () => () => undefined,
        prompt: async () => undefined,
        abort: async () => undefined,
        waitForIdle: async () => undefined,
        steer: async () => undefined,
        followUp: async () => undefined,
        clearQueue: () => ({ steering: [], followUp: [] }),
        fork: nativeFork,
        importFromJsonl: async () => ({ cancelled: false }),
        exportToHtml: async (outputPath: string) => outputPath,
        exportToJsonl: (outputPath: string) => outputPath,
        getSessionStats: () => ({
          sessionFile: currentFile,
          sessionId: currentId,
          userMessages: 0,
          assistantMessages: 0,
          toolCalls: 0,
          toolResults: 0,
          totalMessages: 0,
          tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          cost: 0,
        }),
        getSessionId: () => currentId,
        getSessionFile: () => currentFile,
        dispose,
        bindExtensionUi: async () => undefined,
      }),
    )
    runtime.configure({
      extensionPaths: [],
      skillPaths: [],
      promptPaths: [],
      modelProviders: [
        {
          id: 'test-model-provider',
          register: () => {
            throw new Error('not used by the test Session factory')
          },
        },
      ],
    })
    const config = {
      type: 'fork',
      operationId: '01234567-89ab-4def-8123-456789abcdef',
      sourceSessionId: '11234567-89ab-4def-8123-456789abcdef',
      targetSessionId: '21234567-89ab-4def-8123-456789abcdef',
      entryId: 'selected-entry',
      projectRoot: join(root, 'project'),
      agentDirectory: join(root, 'agent'),
      sourceSessionDirectory,
      sourcePiSessionFile: 'source.jsonl',
      targetSessionDirectory,
      settings: {
        apiProtocol: 'responses',
        baseUrl: 'https://example.test/v1',
        modelId: 'test-model',
        reasoningEffort: null,
        temperature: null,
        maxOutputTokens: 64,
      },
      apiKey: 'test-key',
    } satisfies RuntimeForkConfig

    await expect(runtime.fork(config)).resolves.toEqual({
      outcome: 'completed',
      piSessionId: 'forked-pi-session',
      piSessionFile: 'forked.jsonl',
    })
    expect(nativeFork).toHaveBeenCalledWith('selected-entry')
    expect(dispose).toHaveBeenCalledOnce()
    await expect(readFile(sourceFile, 'utf8')).resolves.toContain('source')
    await expect(readFile(join(targetSessionDirectory, 'forked.jsonl'), 'utf8')).resolves.toContain(
      'forked',
    )
    await expect(readFile(forkedFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('imports through the native Pi Session lifecycle without rewriting the source JSONL', async () => {
    const sourceDirectory = join(root, 'imports')
    const targetSessionDirectory = join(root, 'imported-session')
    const sourceFile = join(sourceDirectory, 'source-history.jsonl')
    const initialFile = join(targetSessionDirectory, 'initial.jsonl')
    const importedFile = join(targetSessionDirectory, 'source-history.jsonl')
    await mkdir(sourceDirectory)
    await writeFile(
      sourceFile,
      [
        JSON.stringify({ type: 'session', version: 3, id: 'source-session', cwd: '/old' }),
        JSON.stringify({
          type: 'message',
          id: 'entry',
          parentId: null,
          message: { role: 'user', content: 'test-key' },
        }),
        '',
      ].join('\n'),
    )
    let currentFile = initialFile
    let currentId = 'initial-session'
    const nativeImport = vi.fn(async (inputPath: string, cwdOverride: string) => {
      expect(cwdOverride).toBe(join(root, 'project'))
      await copyFile(inputPath, importedFile)
      currentFile = importedFile
      currentId = 'source-session'
      return { cancelled: false }
    })
    const dispose = vi.fn(async () => undefined)
    const runtime = new PiAgentRuntime(
      () => undefined,
      async () => {
        await mkdir(targetSessionDirectory, { recursive: true })
        await writeFile(initialFile, '{"type":"session","id":"initial-session"}\n')
        return {
          subscribe: () => () => undefined,
          prompt: async () => undefined,
          abort: async () => undefined,
          waitForIdle: async () => undefined,
          steer: async () => undefined,
          followUp: async () => undefined,
          clearQueue: () => ({ steering: [], followUp: [] }),
          fork: async () => ({ cancelled: false }),
          importFromJsonl: nativeImport,
          exportToHtml: async (outputPath: string) => outputPath,
          exportToJsonl: (outputPath: string) => outputPath,
          getSessionStats: () => ({
            sessionFile: currentFile,
            sessionId: currentId,
            userMessages: 0,
            assistantMessages: 0,
            toolCalls: 0,
            toolResults: 0,
            totalMessages: 0,
            tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            cost: 0,
          }),
          getSessionId: () => currentId,
          getSessionFile: () => currentFile,
          dispose,
          bindExtensionUi: async () => undefined,
        }
      },
    )
    runtime.configure({
      extensionPaths: [],
      skillPaths: [],
      promptPaths: [],
      modelProviders: [
        {
          id: 'test-model-provider',
          register: () => {
            throw new Error('not used by the test Session factory')
          },
        },
      ],
    })
    const config = {
      type: 'import',
      operationId: '01234567-89ab-4def-8123-456789abcdef',
      targetSessionId: '21234567-89ab-4def-8123-456789abcdef',
      projectRoot: join(root, 'project'),
      agentDirectory: join(root, 'agent-import'),
      sourceJsonlPath: sourceFile,
      targetSessionDirectory,
      settings: {
        apiProtocol: 'responses',
        baseUrl: 'https://example.test/v1',
        modelId: 'test-model',
        reasoningEffort: null,
        temperature: null,
        maxOutputTokens: 64,
      },
      apiKey: 'test-key',
    } satisfies RuntimeImportConfig

    await expect(runtime.importSession(config)).resolves.toEqual({
      outcome: 'completed',
      piSessionId: 'source-session',
      piSessionFile: 'source-history.jsonl',
    })
    expect(nativeImport).toHaveBeenCalledWith(sourceFile, join(root, 'project'))
    expect(dispose).toHaveBeenCalledOnce()
    await expect(readFile(sourceFile, 'utf8')).resolves.toContain('test-key')
    const imported = await readFile(importedFile, 'utf8')
    expect(imported).toContain(REDACTED_SECRET)
    expect(imported).not.toContain('test-key')
    await expect(readFile(initialFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('exports through native Pi Session methods without loading Extension code', async () => {
    const sourceSessionDirectory = join(root, 'export-source')
    const exportToJsonl = vi.fn((outputPath: string) => outputPath)
    const exportToHtml = vi.fn(async (outputPath: string) => outputPath)
    const dispose = vi.fn(async () => undefined)
    const factory = vi.fn(async () => ({
      ...(await sessionFactory()),
      exportToJsonl,
      exportToHtml,
      getSessionFile: () => join(sourceSessionDirectory, 'source.jsonl'),
      dispose,
    }))
    const runtime = new PiAgentRuntime(() => undefined, factory)
    runtime.configure({
      extensionPaths: ['/trusted/extensions'],
      skillPaths: ['/trusted/skills'],
      promptPaths: ['/trusted/prompts'],
      modelProviders: [
        {
          id: 'test-model-provider',
          register: () => {
            throw new Error('not used by the test Session factory')
          },
        },
      ],
    })
    const baseConfig = {
      type: 'export',
      operationId: '01234567-89ab-4def-8123-456789abcdef',
      sourceSessionId: '11234567-89ab-4def-8123-456789abcdef',
      format: 'jsonl',
      projectRoot: join(root, 'project'),
      agentDirectory: join(root, 'agent-export'),
      sourceSessionDirectory,
      sourcePiSessionFile: 'source.jsonl',
      destinationPath: join(root, 'exported.jsonl'),
      settings: {
        apiProtocol: 'responses',
        baseUrl: 'https://example.test/v1',
        modelId: 'test-model',
        reasoningEffort: null,
        temperature: null,
        maxOutputTokens: 64,
      },
      apiKey: 'test-key',
    } satisfies RuntimeExportConfig

    await expect(runtime.exportSession(baseConfig)).resolves.toEqual({ outcome: 'completed' })
    expect(exportToJsonl).toHaveBeenCalledWith(join(root, 'exported.jsonl'))
    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionFile: 'source.jsonl',
        extensionPaths: [],
        skillPaths: [],
        promptPaths: [],
      }),
    )

    await expect(
      runtime.exportSession({
        ...baseConfig,
        operationId: '21234567-89ab-4def-8123-456789abcdef',
        format: 'html',
        destinationPath: join(root, 'exported.html'),
      }),
    ).resolves.toEqual({ outcome: 'completed' })
    expect(exportToHtml).toHaveBeenCalledWith(join(root, 'exported.html'))
    expect(dispose).toHaveBeenCalledTimes(2)

    await expect(
      runtime.exportSession({
        ...baseConfig,
        operationId: '31234567-89ab-4def-8123-456789abcdef',
        destinationPath: join(sourceSessionDirectory, 'source.jsonl'),
      }),
    ).rejects.toThrow('cannot overwrite its source history')
    expect(factory).toHaveBeenCalledTimes(2)
  })
})
