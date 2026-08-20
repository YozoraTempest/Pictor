import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Info } from 'lucide-react'
import { vi } from 'vitest'

import { AboutSettings } from '../modules/updater/AboutSettings'
import type { UpdaterClient } from '../modules/updater/shared'
import type { SessionHistoryView, SessionRecord } from '../shared/domain'
import type { AppSnapshot, IpcResult, PictorBridge, RuntimeEvent } from '../shared/desktop-bridge'
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
    getSnapshot: async () => ok(snapshot),
    getAppInfo: async () =>
      ok({
        name: 'Pictor',
        version: '0.1.0',
        platform: 'win32',
        arch: 'x64',
        distribution: 'windows',
        commandInterpreter: { kind: 'bash', available: true, message: null },
      }),
    getPluginBootstrap: async () => ok({ safeMode: false, plugins: [] }),
    getPluginManagerSnapshot: async () =>
      ok({ safeMode: false, restartRequired: false, items: [], issues: [] }),
    installLocalPlugin: async () =>
      ok({ safeMode: false, restartRequired: false, items: [], issues: [] }),
    installPiExtension: async () =>
      ok({ safeMode: false, restartRequired: false, items: [], issues: [] }),
    installPiPackage: async () =>
      ok({ safeMode: false, restartRequired: false, items: [], issues: [] }),
    setPluginEnabled: async () =>
      ok({ safeMode: false, restartRequired: false, items: [], issues: [] }),
    removePlugin: async () =>
      ok({ safeMode: false, restartRequired: false, items: [], issues: [] }),
    restoreBundledPlugin: async () =>
      ok({ safeMode: false, restartRequired: false, items: [], issues: [] }),
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
    inspectSessionHistory: async () =>
      session
        ? ok({ session, tree: null })
        : { ok: false, error: { code: 'not-found', message: '不存在' } },
    forkSession: async () => ok(null),
    cloneSession: async () => ok(null),
    getSettings: async () => ok(snapshot.settings),
    saveSettings: async () => ok(snapshot.settings!),
    testSettings: async () => ok({ outcome: 'success', message: '连接成功' }),
    listModels: async () =>
      ok({ outcome: 'success', message: '已获取 1 个可用模型', models: ['gpt-5.6-sol'] }),
    startRun: async () => ok({ runId }),
    approveCommand,
    rejectCommand: async () => ok(null),
    stopRun: async () => ok(null),
    respondToExtensionUi: async () => ok(null),
    queueRuntimeMessage: async () => ok(null),
    clearRuntimeQueue: async () => ok(null),
    onRuntimeEvent: (_listener: (event: RuntimeEvent) => void) => () => undefined,
  }
}

function installBridge(bridge: PictorBridge): void {
  Object.defineProperty(window, 'pictor', { configurable: true, value: bridge })
}

function createUpdater(overrides: Partial<UpdaterClient> = {}): UpdaterClient {
  return {
    getAppInfo: async () => ({
      name: 'Pictor',
      version: '0.1.0',
      platform: 'win32',
      arch: 'x64',
      distribution: 'windows',
      commandInterpreter: { kind: 'bash', available: true, message: null },
    }),
    checkForUpdates: async () =>
      ok({
        currentVersion: '0.1.0',
        latestVersion: '0.2.0',
        updateAvailable: true,
        packageAvailable: true,
        packageKind: 'windows-nsis',
        publishedAt: now,
      }),
    openUpdate: async () => ok(null),
    ...overrides,
  }
}

function renderApp(bridge: PictorBridge, updater: UpdaterClient = createUpdater()) {
  installBridge(bridge)
  return render(
    <App
      settingsSections={[
        {
          id: 'about',
          label: '关于',
          icon: Info,
          render: () => <AboutSettings client={updater} />,
        },
      ]}
    />,
  )
}

it('renders the empty delegate workspace from a persisted snapshot', async () => {
  renderApp(createBridge(emptySnapshot()))

  expect(await screen.findByRole('heading', { name: '选择一个项目开始' })).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: '新建项目' })).toHaveLength(3)
  expect(screen.getByText('v0.1.0')).toBeInTheDocument()
})

it('opens the Session Tree, inspects a historical branch, and returns to the active leaf', async () => {
  const snapshot: AppSnapshot = {
    projects: [
      {
        id: projectId,
        name: 'Pictor',
        rootPath: 'C:\\Pictor',
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
        title: 'Branched session',
        lastRunStatus: 'completed',
        historyAuthority: 'pi-jsonl',
        createdAt: now,
        updatedAt: now,
      },
    ],
    selectedProjectId: projectId,
    selectedSessionId: sessionId,
    settings: {
      apiProtocol: 'responses',
      baseUrl: 'https://example.test/v1',
      modelId: 'test-model',
      reasoningEffort: null,
      temperature: null,
      maxOutputTokens: null,
      hasApiKey: true,
    },
    issues: [],
  }
  const createProjectedSession = (content: string): SessionRecord => ({
    schemaVersion: 1,
    id: sessionId,
    projectId,
    title: 'Branched session',
    messages: [
      {
        id: messageId,
        role: 'assistant',
        content,
        status: 'completed',
        createdAt: now,
        updatedAt: now,
      },
    ],
    runs: [
      {
        id: runId,
        status: 'completed',
        toolEvents: [],
        error: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
  })
  const activeSession = createProjectedSession('Active response details')
  const historicalSession = createProjectedSession('Archived response details')
  const bridge = createBridge(snapshot, activeSession)
  bridge.forkSession = vi.fn(async () => ok(null))
  bridge.cloneSession = vi.fn(async () => ok(null))
  bridge.inspectSessionHistory = vi.fn(async ({ entryId }) => {
    const selectedEntryId = entryId ?? 'active-entry'
    return ok({
      session: selectedEntryId === 'historical-entry' ? historicalSession : activeSession,
      tree: {
        activeLeafId: 'active-entry',
        selectedEntryId,
        nodes: [
          {
            id: 'historical-entry',
            parentId: null,
            kind: 'assistant',
            label: 'Historical branch',
            timestamp: now,
            depth: 0,
            childCount: 0,
            isActivePath: false,
            isActiveLeaf: false,
            isSelected: selectedEntryId === 'historical-entry',
          },
          {
            id: 'active-entry',
            parentId: null,
            kind: 'assistant',
            label: 'Current branch',
            timestamp: now,
            depth: 0,
            childCount: 0,
            isActivePath: true,
            isActiveLeaf: true,
            isSelected: selectedEntryId === 'active-entry',
          },
        ],
      },
    } satisfies SessionHistoryView)
  })
  renderApp(bridge)

  await screen.findByText('Active response details')
  fireEvent.click(screen.getByRole('button', { name: 'Session Tree' }))
  expect(await screen.findByRole('complementary', { name: 'Session Tree' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Fork 为新 Session' })).toBeDisabled()
  const cloneButton = screen.getByRole('button', { name: 'Clone 当前分支为新 Session' })
  expect(cloneButton).toBeEnabled()
  fireEvent.click(cloneButton)
  await waitFor(() => expect(bridge.cloneSession).toHaveBeenCalledWith({ sessionId }))
  await waitFor(() => expect(cloneButton).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Historical branch' }))

  expect(await screen.findByText('Archived response details')).toBeInTheDocument()
  expect(screen.getByText(/正在查看历史分支/)).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: '任务描述' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '发送任务' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Clone 当前分支为新 Session' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Fork 为新 Session' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Fork 为新 Session' }))
  expect(bridge.forkSession).toHaveBeenCalledWith({
    sessionId,
    entryId: 'historical-entry',
  })

  fireEvent.click(screen.getByRole('button', { name: '返回当前节点' }))
  expect(await screen.findByText('Active response details')).toBeInTheDocument()
  expect(screen.queryByText(/正在查看历史分支/)).not.toBeInTheDocument()
})

it('shows app information and downloads an available update from settings', async () => {
  const checkForUpdates = vi.fn(async () =>
    ok({
      currentVersion: '0.1.0',
      latestVersion: '0.2.0',
      updateAvailable: true,
      packageAvailable: true,
      packageKind: 'windows-nsis' as const,
      publishedAt: now,
    }),
  )
  const openUpdate = vi.fn(async () => ok(null))
  renderApp(createBridge(emptySnapshot()), createUpdater({ checkForUpdates, openUpdate }))

  await screen.findByRole('heading', { name: '选择一个项目开始' })
  fireEvent.click(screen.getByRole('button', { name: '设置' }))
  fireEvent.click(screen.getByRole('button', { name: '关于' }))

  await waitFor(() => expect(screen.getAllByText('v0.1.0')).toHaveLength(2))
  fireEvent.click(screen.getByRole('button', { name: '检查更新' }))
  expect(await screen.findByText('发现新版本 v0.2.0')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '下载发行包' }))
  await waitFor(() => expect(openUpdate).toHaveBeenCalledOnce())
})

it('shows the Linux platform in app information', async () => {
  const bridge: PictorBridge = {
    ...createBridge(emptySnapshot()),
    getAppInfo: async () =>
      ok({
        name: 'Pictor',
        version: '0.1.0',
        platform: 'linux',
        arch: 'x64',
        distribution: 'arch',
        commandInterpreter: {
          kind: 'bash',
          available: false,
          message: '未找到 Bash；命令工具不可用。',
        },
      }),
  }
  renderApp(
    bridge,
    createUpdater({
      getAppInfo: async () => ({
        name: 'Pictor',
        version: '0.1.0',
        platform: 'linux',
        arch: 'x64',
        distribution: 'arch',
        commandInterpreter: {
          kind: 'bash',
          available: false,
          message: '未找到 Bash；命令工具不可用。',
        },
      }),
    }),
  )

  await screen.findByRole('heading', { name: '选择一个项目开始' })
  fireEvent.click(screen.getByRole('button', { name: '设置' }))
  fireEvent.click(screen.getByRole('button', { name: '关于' }))

  expect(await screen.findByText('Linux x64')).toBeInTheDocument()
  expect(screen.getByText('未找到 Bash；命令工具不可用。')).toBeInTheDocument()
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
  renderApp(bridge)

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
  renderApp({ ...createBridge(snapshot), listModels })

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
  renderApp(bridge)

  expect(await screen.findByRole('heading', { name: '运行验证' })).toBeInTheDocument()
  expect(screen.getByText('npm test')).toBeInTheDocument()
  expect(screen.getByText('此命令将以当前 Windows 用户权限运行')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '允许一次' }))

  await waitFor(() =>
    expect(bridge.approveCommand).toHaveBeenCalledWith({ runId, callId: 'call-1' }),
  )
})
