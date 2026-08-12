import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'

import type {
  AppSnapshot,
  IpcResult,
  PictorBridge,
  RuntimeEvent,
  SessionRecord,
} from '../shared/contracts'
import { App } from './App'

const projectId = '11111111-1111-4111-8111-111111111111'
const sessionId = '22222222-2222-4222-8222-222222222222'
const temporaryApiKey = ['temporary', 'key'].join('-')
const runId = '33333333-3333-4333-8333-333333333333'
const messageId = '44444444-4444-4444-8444-444444444444'
const toolId = '55555555-5555-4555-8555-555555555555'
const now = '2026-08-11T00:00:00.000Z'

function ok<T>(value: T): IpcResult<T> {
  return { ok: true, value }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function emptySnapshot(): AppSnapshot {
  return {
    projects: [],
    sessions: [],
    selectedProjectId: null,
    selectedSessionId: null,
    settings: null,
    issues: [],
  }
}

function createBridge(
  snapshot: AppSnapshot,
  session: SessionRecord | null = null,
): PictorBridge & { approveCommand: ReturnType<typeof vi.fn> } {
  const approveCommand = vi.fn(async () => ok(null))
  return {
    getAppInfo: async () => ({ name: 'Pictor', version: '0.1.0', platform: 'win32' }),
    checkForUpdates: async () =>
      ok({
        currentVersion: '0.1.0',
        latestVersion: '0.2.0',
        updateAvailable: true,
        installerAvailable: true,
        publishedAt: now,
      }),
    openUpdate: async () => ok(null),
    getSnapshot: async () => ok(snapshot),
    pickProjectDirectory: async () => ok(null),
    registerProject: async () => ok(snapshot.projects[0]!),
    relinkProject: async () => ok(snapshot.projects[0]!),
    removeProject: async () => ok(null),
    selectContext: async () => ok(null),
    createSession: async () => ok(snapshot.sessions[0]!),
    renameSession: async () => ok(snapshot.sessions[0]!),
    deleteSession: async () => ok(null),
    getSession: async () =>
      session ? ok(session) : { ok: false, error: { code: 'not-found', message: '不存在' } },
    getSettings: async () => ok(snapshot.settings),
    saveSettings: async () => ok(snapshot.settings!),
    testSettings: async () => ok({ outcome: 'success', message: '连接成功' }),
    listModels: async () =>
      ok({ outcome: 'success', message: '已获取 1 个可用模型', models: ['gpt-5.6-sol'] }),
    startRun: async () => ok({ runId }),
    approveCommand,
    rejectCommand: async () => ok(null),
    stopRun: async () => ok(null),
    onRuntimeEvent: (_listener: (event: RuntimeEvent) => void) => () => undefined,
  }
}

function installBridge(bridge: PictorBridge): void {
  Object.defineProperty(window, 'pictor', { configurable: true, value: bridge })
}

it('renders the empty delegate workspace from a persisted snapshot', async () => {
  installBridge(createBridge(emptySnapshot()))
  render(<App />)

  expect(await screen.findByRole('heading', { name: '选择一个项目开始' })).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: '新建项目' })).toHaveLength(3)
  expect(screen.getByText('v0.1.0')).toBeInTheDocument()
})

it('shows app information and downloads an available update from settings', async () => {
  const checkForUpdates = vi.fn(async () =>
    ok({
      currentVersion: '0.1.0',
      latestVersion: '0.2.0',
      updateAvailable: true,
      installerAvailable: true,
      publishedAt: now,
    }),
  )
  const openUpdate = vi.fn(async () => ok(null))
  installBridge({ ...createBridge(emptySnapshot()), checkForUpdates, openUpdate })
  render(<App />)

  await screen.findByRole('heading', { name: '选择一个项目开始' })
  fireEvent.click(screen.getByRole('button', { name: '设置' }))
  fireEvent.click(screen.getByRole('button', { name: '关于' }))

  expect(screen.getAllByText('v0.1.0')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: '检查更新' }))
  expect(await screen.findByText('发现新版本 v0.2.0')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '下载安装包' }))
  await waitFor(() => expect(openUpdate).toHaveBeenCalledOnce())
})

it('saves the selected Responses compatibility mode', async () => {
  const snapshot = emptySnapshot()
  const saveSettings = vi.fn(async (request) =>
    ok({
      apiProtocol: request.apiProtocol,
      baseUrl: request.baseUrl,
      modelId: request.modelId,
      reasoningEffort: request.reasoningEffort,
      temperature: request.temperature,
      maxOutputTokens: request.maxOutputTokens,
      hasApiKey: false,
    }),
  )
  const bridge = { ...createBridge(snapshot), saveSettings }
  installBridge(bridge)
  render(<App />)

  await screen.findByRole('heading', { name: '选择一个项目开始' })
  fireEvent.click(screen.getByRole('button', { name: '设置' }))
  const responsesButton = screen.getByRole('button', { name: 'Responses' })
  fireEvent.click(responsesButton)
  fireEvent.change(screen.getByRole('textbox', { name: '模型' }), {
    target: { value: 'gpt-5.6-sol' },
  })
  fireEvent.change(screen.getByRole('combobox', { name: '模型强度' }), {
    target: { value: 'xhigh' },
  })
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }))

  await waitFor(() =>
    expect(saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        apiProtocol: 'responses',
        modelId: 'gpt-5.6-sol',
        reasoningEffort: 'xhigh',
      }),
    ),
  )
})

it('fetches and selects a model from the compatible endpoint', async () => {
  const snapshot = emptySnapshot()
  const listModels = vi.fn(async () =>
    ok({
      outcome: 'success' as const,
      message: '已获取 2 个可用模型',
      models: ['gpt-4.1', 'gpt-5.6-sol'],
    }),
  )
  installBridge({ ...createBridge(snapshot), listModels })
  render(<App />)

  await screen.findByRole('heading', { name: '选择一个项目开始' })
  fireEvent.click(screen.getByRole('button', { name: '设置' }))
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: temporaryApiKey } })
  fireEvent.click(screen.getByRole('button', { name: '获取模型' }))

  const availableModels = await screen.findByRole('combobox', { name: '模型' })
  fireEvent.change(availableModels, { target: { value: 'gpt-5.6-sol' } })
  expect(availableModels).toHaveValue('gpt-5.6-sol')
  expect(listModels).toHaveBeenCalledWith({
    baseUrl: 'https://api.openai.com/v1',
    apiKey: temporaryApiKey,
  })
})

it('renders an exact command approval and allows it once', async () => {
  const snapshot: AppSnapshot = {
    projects: [
      {
        id: projectId,
        name: 'Pictor',
        rootPath: 'E:\\code\\Pictor',
        trustedAt: now,
        availability: 'available',
        createdAt: now,
        updatedAt: now,
      },
    ],
    sessions: [
      {
        id: sessionId,
        projectId,
        title: '运行验证',
        lastRunStatus: 'awaiting-approval',
        createdAt: now,
        updatedAt: now,
      },
    ],
    selectedProjectId: projectId,
    selectedSessionId: sessionId,
    settings: {
      apiProtocol: 'chat-completions',
      baseUrl: 'https://api.example.test/v1',
      modelId: 'model-test',
      reasoningEffort: null,
      temperature: null,
      maxOutputTokens: null,
      hasApiKey: true,
    },
    issues: [],
  }
  const session: SessionRecord = {
    schemaVersion: 1,
    id: sessionId,
    projectId,
    title: '运行验证',
    messages: [
      {
        id: messageId,
        role: 'user',
        content: '运行测试',
        status: 'completed',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: '66666666-6666-4666-8666-666666666666',
        role: 'assistant',
        content: '',
        status: 'streaming',
        createdAt: now,
        updatedAt: now,
      },
    ],
    runs: [
      {
        id: runId,
        status: 'awaiting-approval',
        error: null,
        createdAt: now,
        updatedAt: now,
        toolEvents: [
          {
            id: toolId,
            callId: 'call-1',
            kind: 'command',
            label: '运行测试',
            path: null,
            command: {
              command: 'npm test',
              cwd: 'E:\\code\\Pictor',
              purpose: '验证改动',
              approval: 'pending',
            },
            status: 'running',
            output: null,
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
    ],
    createdAt: now,
    updatedAt: now,
  }
  const bridge = createBridge(snapshot, session)
  installBridge(bridge)
  render(<App />)

  expect(await screen.findByRole('heading', { name: '运行验证' })).toBeInTheDocument()
  expect(screen.getByText('npm test')).toBeInTheDocument()
  expect(screen.getByText('此命令将以当前 Windows 用户权限运行')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '允许一次' }))

  await waitFor(() =>
    expect(bridge.approveCommand).toHaveBeenCalledWith({ runId, callId: 'call-1' }),
  )
})

it('ignores an older runtime refresh that resolves after the terminal state', async () => {
  const project = {
    id: projectId,
    name: 'Pictor',
    rootPath: 'E:\\code\\Pictor',
    trustedAt: now,
    availability: 'available' as const,
    createdAt: now,
    updatedAt: now,
  }
  const runningSession: SessionRecord = {
    schemaVersion: 1,
    id: sessionId,
    projectId,
    title: '运行验证',
    messages: [],
    runs: [
      {
        id: runId,
        status: 'running',
        error: null,
        toolEvents: [],
        createdAt: now,
        updatedAt: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
  }
  const completedSession: SessionRecord = {
    ...runningSession,
    runs: [{ ...runningSession.runs[0]!, status: 'completed' }],
  }
  const snapshot: AppSnapshot = {
    projects: [project],
    sessions: [
      {
        id: sessionId,
        projectId,
        title: runningSession.title,
        lastRunStatus: 'running',
        createdAt: now,
        updatedAt: now,
      },
    ],
    selectedProjectId: projectId,
    selectedSessionId: sessionId,
    settings: null,
    issues: [],
  }
  const staleRefresh = deferred<IpcResult<SessionRecord>>()
  const terminalRefresh = deferred<IpcResult<SessionRecord>>()
  const getSession = vi
    .fn()
    .mockResolvedValueOnce(ok(runningSession))
    .mockReturnValueOnce(staleRefresh.promise)
    .mockReturnValueOnce(terminalRefresh.promise)
  let runtimeListener: ((event: RuntimeEvent) => void) | null = null
  installBridge({
    ...createBridge(snapshot, runningSession),
    getSession,
    onRuntimeEvent: (listener) => {
      runtimeListener = listener
      return () => undefined
    },
  })
  render(<App />)

  expect(await screen.findByRole('heading', { name: '运行验证' })).toBeInTheDocument()
  if (!runtimeListener) throw new Error('Runtime listener was not registered')
  act(() => {
    runtimeListener?.({
      type: 'message.completed',
      runId,
      sessionId,
      messageId,
      content: 'Done',
      at: now,
    })
    runtimeListener?.({
      type: 'run.stateChanged',
      runId,
      sessionId,
      status: 'completed',
      error: null,
      at: now,
    })
  })
  await waitFor(() => expect(getSession).toHaveBeenCalledTimes(3))

  await act(async () => terminalRefresh.resolve(ok(completedSession)))
  expect(await screen.findByText('已完成')).toBeInTheDocument()
  await act(async () => staleRefresh.resolve(ok(runningSession)))
  expect(screen.getByText('已完成')).toBeInTheDocument()
})
