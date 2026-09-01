// @vitest-environment node

import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentSessionRuntime,
  AgentSessionEvent,
  ExtensionCommandContextActions,
  ExtensionUIContext,
} from '@earendil-works/pi-coding-agent'

import type {
  RuntimeCompactConfig,
  RuntimeEvent,
  RuntimeExportConfig,
  RuntimeForkConfig,
  RuntimeImportConfig,
  RuntimeLabelConfig,
  RuntimeNavigateConfig,
  RuntimeStartConfig,
  RuntimeSessionOpenConfig,
} from '../shared/runtime-protocol.js'
import { REDACTED_SECRET } from '../shared/secret-redaction.js'
import {
  PICTOR_TUI_SESSION_REPLACEMENT_ERROR,
  PiAgentRuntime,
  createPiInteractiveRunner,
} from './pi-adapter.js'

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
  navigateTree: async () => ({ cancelled: false }),
  compact: async () => ({ summary: 'summary', firstKeptEntryId: 'entry', tokensBefore: 1 }),
  abortCompaction: () => undefined,
  abortBranchSummary: () => undefined,
  labelEntry: () => undefined,
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
  getActiveLeafId: () => 'active-entry',
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

  it('reuses one open Pi Session across multiple Pictor Runs', async () => {
    const prompt = vi.fn(async () => undefined)
    const dispose = vi.fn(async () => undefined)
    const factory = vi.fn(async () => ({
      ...(await sessionFactory()),
      prompt,
      dispose,
    }))
    const runtime = new PiAgentRuntime(() => undefined, factory)
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
    const createConfig = (runId: string, messageId: string): RuntimeStartConfig => ({
      type: 'start',
      runId,
      sessionId: '11234567-89ab-4def-8123-456789abcdef',
      messageId,
      projectRoot: join(root, 'project'),
      agentDirectory: join(root, 'agent-long-session'),
      sessionDirectory: join(root, 'session-long-session'),
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
      prompt: 'continue',
    })

    await runtime.start(
      createConfig('01234567-89ab-4def-8123-456789abcdef', '21234567-89ab-4def-8123-456789abcdef'),
    )
    await runtime.start(
      createConfig('31234567-89ab-4def-8123-456789abcdef', '41234567-89ab-4def-8123-456789abcdef'),
    )

    expect(factory).toHaveBeenCalledOnce()
    expect(prompt).toHaveBeenCalledTimes(2)
    expect(dispose).not.toHaveBeenCalled()
    await runtime.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('exposes the InteractiveMode runner only through the Runtime public contract', async () => {
    const runner = { run: vi.fn(async () => undefined) }
    const runtime = new PiAgentRuntime(
      () => undefined,
      async () => ({
        ...(await sessionFactory()),
        createInteractiveRunner: () => runner,
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
    const config: RuntimeSessionOpenConfig = {
      type: 'session.open',
      operationId: '01234567-89ab-4def-8123-456789abcdef',
      sessionId: '11234567-89ab-4def-8123-456789abcdef',
      projectRoot: join(root, 'project'),
      agentDirectory: join(root, 'agent-interactive'),
      sessionDirectory: join(root, 'session-interactive'),
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
    }

    await runtime.openSession(config)
    expect(runtime.createInteractiveRunner()).toBe(runner)
    await runtime.dispose()
  })

  it('rejects InteractiveMode Session replacement before Pi can change identity', async () => {
    const beforeSessionInvalidate = vi.fn()
    const rebindSession = vi.fn()
    const newSession = vi.fn(
      async (_options?: Parameters<AgentSessionRuntime['newSession']>[0]) => ({
        cancelled: false,
      }),
    )
    const fork = vi.fn(
      async (_entryId: string, _options?: Parameters<AgentSessionRuntime['fork']>[1]) => ({
        cancelled: false,
      }),
    )
    const switchSession = vi.fn(
      async (
        _sessionPath: string,
        _options?: Parameters<AgentSessionRuntime['switchSession']>[1],
      ) => ({ cancelled: false }),
    )
    const importFromJsonl = vi.fn(async (_inputPath: string, _cwdOverride?: string) => ({
      cancelled: false,
    }))
    const publicRuntime = {
      setBeforeSessionInvalidate: beforeSessionInvalidate,
      setRebindSession: rebindSession,
      newSession,
      fork,
      switchSession,
      importFromJsonl,
    } satisfies Pick<
      AgentSessionRuntime,
      | 'setBeforeSessionInvalidate'
      | 'setRebindSession'
      | 'newSession'
      | 'fork'
      | 'switchSession'
      | 'importFromJsonl'
    >

    const pictorBeforeInvalidate = vi.fn()
    const pictorRebind = vi.fn(async () => undefined)
    beforeSessionInvalidate(pictorBeforeInvalidate)
    rebindSession(pictorRebind)

    let adaptedRuntime: AgentSessionRuntime | undefined
    const run = vi.fn(async () => {
      const runtime = adaptedRuntime
      expect(runtime).toBeDefined()
      if (!runtime) throw new Error('InteractiveMode runtime was not adapted')

      // These calls model InteractiveMode's constructor hook registration.
      runtime.setBeforeSessionInvalidate(() => undefined)
      runtime.setRebindSession(async () => undefined)
      const rejectReplacement = (invoke: () => unknown) =>
        expect(Promise.resolve().then(invoke)).rejects.toThrow(PICTOR_TUI_SESSION_REPLACEMENT_ERROR)
      await rejectReplacement(() => runtime.newSession())
      await rejectReplacement(() => runtime.fork('entry'))
      await rejectReplacement(() => runtime.fork('entry', { position: 'at' }))
      await rejectReplacement(() => runtime.switchSession('/other/session.jsonl'))
      await rejectReplacement(() => runtime.importFromJsonl('/other/session.jsonl'))
    })

    // This strict public-method spy facade exercises the deterministic runner
    // seam; production passes a real AgentSessionRuntime instance.
    const runner = createPiInteractiveRunner(
      publicRuntime as unknown as AgentSessionRuntime,
      undefined,
      (runtime) => {
        adaptedRuntime = runtime
        return { run }
      },
    )
    await runner.run()

    expect(run).toHaveBeenCalledOnce()
    expect(beforeSessionInvalidate).toHaveBeenCalledOnce()
    expect(beforeSessionInvalidate).toHaveBeenCalledWith(pictorBeforeInvalidate)
    expect(rebindSession).toHaveBeenCalledOnce()
    expect(rebindSession).toHaveBeenCalledWith(pictorRebind)
    expect(newSession).not.toHaveBeenCalled()
    expect(fork).not.toHaveBeenCalled()
    expect(switchSession).not.toHaveBeenCalled()
    expect(importFromJsonl).not.toHaveBeenCalled()
  })

  it('applies a model control to the already-open Pi Session', async () => {
    const modelRuntime = {} as never
    const nextModel = { id: 'next-model', provider: 'test-provider' } as never
    const register = vi.fn(() => nextModel)
    const setModel = vi.fn(async () => undefined)
    const runtime = new PiAgentRuntime(
      () => undefined,
      async () => ({
        ...(await sessionFactory()),
        getModelId: () => 'current-model',
        getModelRuntime: () => modelRuntime,
        setModel,
      }),
    )
    runtime.configure({
      extensionPaths: [],
      skillPaths: [],
      promptPaths: [],
      modelProviders: [
        {
          id: 'test-model-provider',
          register,
        },
      ],
    })
    const sessionId = '11234567-89ab-4def-8123-456789abcdef'
    await runtime.start({
      type: 'start',
      runId: '01234567-89ab-4def-8123-456789abcdef',
      sessionId,
      messageId: '21234567-89ab-4def-8123-456789abcdef',
      projectRoot: join(root, 'project'),
      agentDirectory: join(root, 'agent-model'),
      sessionDirectory: join(root, 'session-model'),
      resumeSession: false,
      settings: {
        apiProtocol: 'responses',
        baseUrl: 'https://example.test/v1',
        modelId: 'current-model',
        reasoningEffort: null,
        temperature: null,
        maxOutputTokens: 64,
      },
      apiKey: 'test-key',
      prompt: 'start',
    })

    await runtime.setRuntimeControls(sessionId, {
      modelId: 'next-model',
      thinkingLevel: 'off',
      activeTools: ['read'],
      steeringMode: 'one-at-a-time',
      followUpMode: 'one-at-a-time',
    })

    expect(register).toHaveBeenCalledWith(
      modelRuntime,
      expect.objectContaining({ modelId: 'next-model' }),
      'test-key',
    )
    expect(setModel).toHaveBeenCalledWith(nextModel)
  })

  it('coordinates native Session replacement with Main prepare and commit acknowledgements', async () => {
    const events: RuntimeEvent[] = []
    const sourcePath = join(root, 'session-replacement', 'source.jsonl')
    const targetPath = join(root, 'session-replacement', 'target.jsonl')
    let currentPath = sourcePath
    let currentId = 'source-pi-session'
    let beforeSessionInvalidate: (() => void) | undefined
    let afterRebind: (() => Promise<void>) | undefined
    let listener: ((event: AgentSessionEvent) => void) | undefined
    const unsubscribe = vi.fn(() => {
      listener = undefined
    })
    const subscribe = vi.fn((next: (event: AgentSessionEvent) => void) => {
      listener = next
      return unsubscribe
    })
    let commandActions: ExtensionCommandContextActions | undefined
    let extensionUiContext: ExtensionUIContext | undefined
    const withSession = vi.fn(async () => undefined)
    const nativeNewSession = vi.fn(
      async (options?: Parameters<ExtensionCommandContextActions['newSession']>[0]) => {
        currentPath = targetPath
        currentId = 'target-pi-session'
        beforeSessionInvalidate?.()
        extensionUiContext?.setStatus('target-status', 'Target session status')
        extensionUiContext?.setWidget('target-widget', ['Target session widget'])
        extensionUiContext?.setTitle('Target session')
        await afterRebind?.()
        await options?.withSession?.({} as never)
        return { cancelled: false }
      },
    )
    const runtime = new PiAgentRuntime(
      (event) => events.push(event),
      async () => ({
        ...(await sessionFactory()),
        subscribe,
        newSession: nativeNewSession,
        getSessionId: () => currentId,
        getSessionFile: () => currentPath,
        bindExtensionUi: async (
          _context: ExtensionUIContext,
          options?: {
            commandContextActions?: ExtensionCommandContextActions
            beforeRebind?: () => Promise<void>
            beforeSessionInvalidate?: () => void
            afterRebind?: () => Promise<void>
          },
        ) => {
          extensionUiContext = _context
          commandActions = options?.commandContextActions
          beforeSessionInvalidate = options?.beforeSessionInvalidate
          afterRebind = options?.afterRebind
          await options?.afterRebind?.()
        },
      }),
    )
    const replacementRequests: Array<{
      phase: 'prepare' | 'commit' | 'abort'
      kind: 'new' | 'fork' | 'switch'
      targetSessionId: string
      piSessionId: string | null
      piSessionPath: string | null
    }> = []
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
      requestSessionReplacement: async (request) => {
        replacementRequests.push(request)
        return request.phase === 'prepare'
          ? { accepted: true, targetSessionId: '21234567-89ab-4def-8123-456789abcdef' }
          : { accepted: true }
      },
    })

    await runtime.start({
      type: 'start',
      runId: '01234567-89ab-4def-8123-456789abcdef',
      sessionId: '11234567-89ab-4def-8123-456789abcdef',
      messageId: '31234567-89ab-4def-8123-456789abcdef',
      projectRoot: join(root, 'project'),
      agentDirectory: join(root, 'agent-replacement'),
      sessionDirectory: join(root, 'session-replacement'),
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

    expect(commandActions).toBeDefined()
    const replacement = await commandActions!.newSession({ withSession })

    expect(replacement).toEqual({ cancelled: false })
    expect(nativeNewSession).toHaveBeenCalledOnce()
    expect(withSession).toHaveBeenCalledOnce()
    expect(replacementRequests.map(({ phase }) => phase)).toEqual(['prepare', 'commit'])
    expect(subscribe).toHaveBeenCalledTimes(2)
    expect(unsubscribe).toHaveBeenCalled()
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'extension.ui.status',
        sessionId: '21234567-89ab-4def-8123-456789abcdef',
        key: 'target-status',
        text: 'Target session status',
      }),
    )
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'extension.ui.widget',
        sessionId: '21234567-89ab-4def-8123-456789abcdef',
        key: 'target-widget',
        lines: ['Target session widget'],
      }),
    )
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'extension.ui.title',
        sessionId: '21234567-89ab-4def-8123-456789abcdef',
        title: 'Target session',
      }),
    )
    listener?.({ type: 'session_info_changed', name: 'Replaced session' })
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'session.infoChanged',
        sessionId: '21234567-89ab-4def-8123-456789abcdef',
        name: 'Replaced session',
      }),
    )
    expect(replacementRequests[1]).toMatchObject({
      kind: 'new',
      targetSessionId: '21234567-89ab-4def-8123-456789abcdef',
      piSessionId: 'target-pi-session',
      piSessionPath: targetPath,
    })
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'session.replaced',
        sourceSessionId: '11234567-89ab-4def-8123-456789abcdef',
        targetSessionId: '21234567-89ab-4def-8123-456789abcdef',
        piSessionPath: targetPath,
      }),
    )
  })

  it('delegates steering, follow-up, and queue clearing to the active Pi Session', async () => {
    const events: RuntimeEvent[] = []
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
      (event) => events.push(event),
      async () => ({
        subscribe: () => () => undefined,
        prompt,
        steer,
        followUp,
        clearQueue,
        fork: async () => ({ cancelled: false }),
        importFromJsonl: async () => ({ cancelled: false }),
        navigateTree: async () => ({ cancelled: false }),
        compact: async () => ({ summary: 'summary', firstKeptEntryId: 'entry', tokensBefore: 1 }),
        abortCompaction: () => undefined,
        abortBranchSummary: () => undefined,
        labelEntry: () => undefined,
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
        getActiveLeafId: () => 'active-entry',
        getDiagnostics: () => [{ type: 'warning', message: 'Extension warning' }],
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
      images: [{ data: 'aW1hZ2U=', mimeType: 'image/png', name: 'fixture.png' }],
    })
    await vi.waitFor(() => expect(prompt).toHaveBeenCalled())
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'runtime.diagnostic',
        severity: 'warning',
        message: 'Extension warning',
      }),
    )
    expect(prompt).toHaveBeenCalledWith('start', {
      expandPromptTemplates: true,
      images: [{ type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' }],
    })

    await runtime.queueMessage(runId, 'steer', 'redirect')
    await runtime.queueMessage(runId, 'follow-up', 'continue')
    runtime.clearQueue(runId)

    expect(steer).toHaveBeenCalledWith('redirect')
    expect(followUp).toHaveBeenCalledWith('continue')
    expect(clearQueue).toHaveBeenCalledOnce()
    finishIdle?.()
    await running
  })

  it('streams Thinking content and exposes native auto-retry state', async () => {
    const events: RuntimeEvent[] = []
    let listener: ((event: AgentSessionEvent) => void) | undefined
    const runtime = new PiAgentRuntime(
      (event) => events.push(event),
      async () => ({
        ...(await sessionFactory()),
        subscribe: (next) => {
          listener = next
          return () => {
            listener = undefined
          }
        },
        prompt: async () => {
          listener?.({
            type: 'auto_retry_start',
            attempt: 1,
            maxAttempts: 3,
            delayMs: 500,
            errorMessage: 'temporary failure',
          })
          listener?.({
            type: 'message_update',
            message: {} as never,
            assistantMessageEvent: {
              type: 'thinking_delta',
              contentIndex: 0,
              delta: 'Reasoning step',
              partial: {} as never,
            },
          })
          listener?.({
            type: 'message_update',
            message: {} as never,
            assistantMessageEvent: {
              type: 'text_delta',
              contentIndex: 1,
              delta: 'Final answer',
              partial: {} as never,
            },
          })
          listener?.({ type: 'auto_retry_end', success: true, attempt: 1 })
        },
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

    await runtime.start({
      type: 'start',
      runId: '71234567-89ab-4def-8123-456789abcdef',
      sessionId: '81234567-89ab-4def-8123-456789abcdef',
      messageId: '91234567-89ab-4def-8123-456789abcdef',
      projectRoot: join(root, 'project'),
      agentDirectory: join(root, 'agent-thinking'),
      sessionDirectory: join(root, 'session-thinking'),
      resumeSession: false,
      settings: {
        apiProtocol: 'responses',
        baseUrl: 'https://example.test/v1',
        modelId: 'test-model',
        reasoningEffort: 'high',
        temperature: null,
        maxOutputTokens: 64,
      },
      apiKey: 'test-key',
      prompt: 'think',
    })

    expect(events).toContainEqual(
      expect.objectContaining({ type: 'retry.stateChanged', status: 'scheduled', attempt: 1 }),
    )
    expect(
      events
        .filter((event) => event.type === 'message.delta')
        .map((event) => event.delta)
        .join(''),
    ).toBe('Thinking\n\nReasoning step\n\nFinal answer')
  })

  it('forks through the native Pi Session lifecycle and preserves Pi file placement', async () => {
    const sourceSessionDirectory = join(root, 'source-session')
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
        navigateTree: async () => ({ cancelled: false }),
        compact: async () => ({ summary: 'summary', firstKeptEntryId: 'entry', tokensBefore: 1 }),
        abortCompaction: () => undefined,
        abortBranchSummary: () => undefined,
        labelEntry: () => undefined,
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
        getActiveLeafId: () => 'active-entry',
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
      sourcePiSessionPath: sourceFile,
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
      piSessionPath: forkedFile,
    })
    expect(nativeFork).toHaveBeenCalledWith('selected-entry', { position: 'at' })
    expect(dispose).toHaveBeenCalledOnce()
    await expect(readFile(sourceFile, 'utf8')).resolves.toContain('source')
    await expect(readFile(forkedFile, 'utf8')).resolves.toContain('forked')
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
          navigateTree: async () => ({ cancelled: false }),
          compact: async () => ({ summary: 'summary', firstKeptEntryId: 'entry', tokensBefore: 1 }),
          abortCompaction: () => undefined,
          abortBranchSummary: () => undefined,
          labelEntry: () => undefined,
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
          getActiveLeafId: () => 'active-entry',
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
      piSessionPath: importedFile,
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
    const sourceFile = join(sourceSessionDirectory, 'source.jsonl')
    const sourceContent = '{"type":"session","version":3,"id":"source-session"}\n'
    await mkdir(sourceSessionDirectory)
    await writeFile(sourceFile, sourceContent)
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
      sourcePiSessionPath: sourceFile,
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
        sessionFile: expect.stringMatching(/\.pictor-export-/),
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
    await expect(readFile(sourceFile, 'utf8')).resolves.toBe(sourceContent)
    expect(
      (await readdir(sourceSessionDirectory)).filter((name) => name.startsWith('.pictor-export-')),
    ).toEqual([])

    await expect(
      runtime.exportSession({
        ...baseConfig,
        operationId: '31234567-89ab-4def-8123-456789abcdef',
        destinationPath: join(sourceSessionDirectory, 'source.jsonl'),
      }),
    ).rejects.toThrow('cannot overwrite its source history')
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('navigates the active leaf through the native Pi Session lifecycle', async () => {
    const sourceSessionDirectory = join(root, 'navigate-source')
    const sourceFile = join(sourceSessionDirectory, 'source.jsonl')
    await mkdir(sourceSessionDirectory)
    await writeFile(
      sourceFile,
      [
        JSON.stringify({
          type: 'session',
          version: 3,
          id: 'pi-session',
          cwd: join(root, 'project'),
        }),
        JSON.stringify({
          type: 'message',
          id: 'active-answer',
          parentId: null,
          message: { role: 'assistant', content: 'Active answer', stopReason: 'stop' },
        }),
        '',
      ].join('\n'),
    )
    let activeLeafId: string | null = 'active-answer'
    const navigateTree = vi.fn(
      async (
        entryId: string,
        options: { summarize: boolean; customInstructions?: string },
      ): Promise<{ cancelled: boolean; editorText?: string; summaryEntry?: unknown }> => {
        expect(options).toEqual({ summarize: false })
        activeLeafId = entryId
        return { cancelled: false }
      },
    )
    const bindExtensionUi = vi.fn(async () => undefined)
    const dispose = vi.fn(async () => undefined)
    const factory = vi.fn(async () => ({
      ...(await sessionFactory()),
      navigateTree,
      getSessionFile: () => sourceFile,
      getActiveLeafId: () => activeLeafId,
      dispose,
      bindExtensionUi,
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
    const config = {
      type: 'navigate',
      operationId: '01234567-89ab-4def-8123-456789abcdef',
      sourceSessionId: '11234567-89ab-4def-8123-456789abcdef',
      entryId: 'historical-answer',
      summarize: false,
      customInstructions: null,
      activeLeafId: 'active-answer',
      projectRoot: join(root, 'project'),
      agentDirectory: join(root, 'agent-navigate'),
      sourcePiSessionPath: sourceFile,
      settings: {
        apiProtocol: 'responses',
        baseUrl: 'https://example.test/v1',
        modelId: 'test-model',
        reasoningEffort: null,
        temperature: null,
        maxOutputTokens: 64,
      },
      apiKey: 'test-key',
    } satisfies RuntimeNavigateConfig

    await runtime.openSession({
      type: 'session.open',
      operationId: '41234567-89ab-4def-8123-456789abcdef',
      sessionId: config.sourceSessionId,
      projectRoot: config.projectRoot,
      agentDirectory: config.agentDirectory,
      sessionDirectory: sourceSessionDirectory,
      resumeSession: true,
      piSessionPath: sourceFile,
      activeLeafId: config.activeLeafId,
      settings: config.settings,
      apiKey: config.apiKey,
    })
    await expect(runtime.navigateSession(config)).resolves.toEqual({
      outcome: 'completed',
      activeLeafId: 'historical-answer',
      editorText: null,
      summaryCreated: false,
    })
    expect(navigateTree).toHaveBeenCalledWith('historical-answer', { summarize: false })
    expect(factory).toHaveBeenCalledOnce()
    expect(bindExtensionUi).toHaveBeenCalledOnce()
    expect(dispose).not.toHaveBeenCalled()

    navigateTree.mockResolvedValueOnce({ cancelled: true })
    await expect(
      runtime.navigateSession({
        ...config,
        operationId: '21234567-89ab-4def-8123-456789abcdef',
      }),
    ).resolves.toEqual({ outcome: 'cancelled' })

    activeLeafId = null
    navigateTree.mockResolvedValueOnce({
      cancelled: false,
      editorText: 'Re-edit this message',
      summaryEntry: {},
    })
    await expect(
      runtime.navigateSession({
        ...config,
        operationId: '31234567-89ab-4def-8123-456789abcdef',
        summarize: true,
        customInstructions: 'Preserve decisions',
      }),
    ).resolves.toEqual({
      outcome: 'completed',
      activeLeafId: null,
      editorText: 'Re-edit this message',
      summaryCreated: true,
    })
    expect(navigateTree).toHaveBeenLastCalledWith('historical-answer', {
      summarize: true,
      customInstructions: 'Preserve decisions',
    })
    await runtime.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('compacts the active branch and emits the native Compaction lifecycle', async () => {
    const sourceSessionDirectory = join(root, 'compact-source')
    const sourceFile = join(sourceSessionDirectory, 'source.jsonl')
    await mkdir(sourceSessionDirectory)
    await writeFile(sourceFile, '{"type":"session","version":3,"id":"pi-session"}\n')
    const events: RuntimeEvent[] = []
    let listener: ((event: AgentSessionEvent) => void) | undefined
    const compact = vi.fn(async (customInstructions?: string) => {
      listener?.({ type: 'compaction_start', reason: 'manual' })
      const result = {
        summary: 'Compacted decisions',
        firstKeptEntryId: 'kept-entry',
        tokensBefore: 120,
        estimatedTokensAfter: 30,
      }
      listener?.({
        type: 'compaction_end',
        reason: 'manual',
        result,
        aborted: false,
        willRetry: false,
      })
      expect(customInstructions).toBe('Keep decisions')
      return result
    })
    const dispose = vi.fn(async () => undefined)
    const factory = vi.fn(async () => ({
      ...(await sessionFactory()),
      subscribe: (next: typeof listener) => {
        listener = next
        return () => {
          listener = undefined
        }
      },
      compact,
      getSessionFile: () => sourceFile,
      getActiveLeafId: () => 'compaction-entry',
      dispose,
    }))
    const runtime = new PiAgentRuntime((event) => events.push(event), factory)
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
      type: 'compact',
      operationId: '01234567-89ab-4def-8123-456789abcdef',
      sourceSessionId: '11234567-89ab-4def-8123-456789abcdef',
      customInstructions: 'Keep decisions',
      activeLeafId: 'active-entry',
      projectRoot: join(root, 'project'),
      agentDirectory: join(root, 'agent-compact'),
      sourcePiSessionPath: sourceFile,
      settings: {
        apiProtocol: 'responses',
        baseUrl: 'https://example.test/v1',
        modelId: 'test-model',
        reasoningEffort: null,
        temperature: null,
        maxOutputTokens: 64,
      },
      apiKey: 'test-key',
    } satisfies RuntimeCompactConfig

    await runtime.openSession({
      type: 'session.open',
      operationId: '41234567-89ab-4def-8123-456789abcdef',
      sessionId: config.sourceSessionId,
      projectRoot: config.projectRoot,
      agentDirectory: config.agentDirectory,
      sessionDirectory: sourceSessionDirectory,
      resumeSession: true,
      piSessionPath: sourceFile,
      activeLeafId: config.activeLeafId,
      settings: config.settings,
      apiKey: config.apiKey,
    })
    await expect(runtime.compactSession(config)).resolves.toEqual({
      outcome: 'completed',
      activeLeafId: 'compaction-entry',
      tokensBefore: 120,
      estimatedTokensAfter: 30,
    })
    expect(events.filter((event) => event.type === 'compaction.stateChanged')).toEqual([
      expect.objectContaining({
        type: 'compaction.stateChanged',
        status: 'running',
        reason: 'manual',
      }),
      expect.objectContaining({
        type: 'compaction.stateChanged',
        status: 'completed',
        tokensBefore: 120,
        estimatedTokensAfter: 30,
      }),
    ])
    expect(factory).toHaveBeenCalledOnce()
    expect(dispose).not.toHaveBeenCalled()
    await runtime.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('appends native Pi label entries and returns the resulting leaf', async () => {
    const sourceSessionDirectory = join(root, 'label-source')
    const sourceFile = join(sourceSessionDirectory, 'source.jsonl')
    await mkdir(sourceSessionDirectory)
    await writeFile(sourceFile, '{"type":"session","version":3,"id":"pi-session"}\n')
    const labelEntry = vi.fn()
    const dispose = vi.fn(async () => undefined)
    const factory = vi.fn(async () => ({
      ...(await sessionFactory()),
      labelEntry,
      getSessionFile: () => sourceFile,
      getActiveLeafId: () => 'label-entry',
      dispose,
    }))
    const runtime = new PiAgentRuntime(() => undefined, factory)
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
      type: 'label',
      operationId: '01234567-89ab-4def-8123-456789abcdef',
      sourceSessionId: '11234567-89ab-4def-8123-456789abcdef',
      entryId: 'target-entry',
      label: 'checkpoint',
      activeLeafId: 'active-entry',
      projectRoot: join(root, 'project'),
      agentDirectory: join(root, 'agent-label'),
      sourcePiSessionPath: sourceFile,
      settings: {
        apiProtocol: 'responses',
        baseUrl: 'https://example.test/v1',
        modelId: 'test-model',
        reasoningEffort: null,
        temperature: null,
        maxOutputTokens: 64,
      },
      apiKey: 'test-key',
    } satisfies RuntimeLabelConfig

    await runtime.openSession({
      type: 'session.open',
      operationId: '41234567-89ab-4def-8123-456789abcdef',
      sessionId: config.sourceSessionId,
      projectRoot: config.projectRoot,
      agentDirectory: config.agentDirectory,
      sessionDirectory: sourceSessionDirectory,
      resumeSession: true,
      piSessionPath: sourceFile,
      activeLeafId: config.activeLeafId,
      settings: config.settings,
      apiKey: config.apiKey,
    })
    await expect(runtime.labelSessionEntry(config)).resolves.toEqual({
      outcome: 'completed',
      activeLeafId: 'label-entry',
    })
    expect(labelEntry).toHaveBeenCalledWith('target-entry', 'checkpoint')
    expect(factory).toHaveBeenCalledOnce()
    expect(dispose).not.toHaveBeenCalled()
    await runtime.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })
})
