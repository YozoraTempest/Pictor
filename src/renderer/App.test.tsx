import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    getAppInfo: async () => ({ name: 'Pictor', version: '0.1.0', platform: 'win32' }),
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

it('saves the selected Responses compatibility mode', async () => {
  const snapshot = emptySnapshot()
  const saveSettings = vi.fn(async (request) =>
    ok({
      apiProtocol: request.apiProtocol,
      baseUrl: request.baseUrl,
      modelId: request.modelId,
      temperature: request.temperature,
      maxOutputTokens: request.maxOutputTokens,
      hasApiKey: false,
    }),
  )
  const bridge = { ...createBridge(snapshot), saveSettings }
  installBridge(bridge)
  render(<App />)

  await screen.findByRole('heading', { name: '选择一个项目开始' })
  fireEvent.click(screen.getByRole('button', { name: '模型设置' }))
  const responsesButton = screen.getByRole('button', { name: 'Responses' })
  fireEvent.click(responsesButton)
  fireEvent.change(screen.getByRole('textbox', { name: '模型' }), {
    target: { value: 'gpt-5.6-sol' },
  })
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }))

  await waitFor(() =>
    expect(saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ apiProtocol: 'responses', modelId: 'gpt-5.6-sol' }),
    ),
  )
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
