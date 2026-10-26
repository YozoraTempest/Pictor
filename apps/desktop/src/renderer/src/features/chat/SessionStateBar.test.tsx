// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import type { ChatJob } from '@pictor/shared'

import type { KernelInfo } from '../../../../shared/bridge.js'
import { useWorkspaceStore } from '../../app/workspace-store.js'
import { useChatStore } from './chat-store.js'
import { SessionStateBar } from './SessionStateBar.js'

afterEach(() => {
  cleanup()
})

/** One kernel that can stop jobs, and the conversation filed under it. */
function kernel(jobs: boolean): KernelInfo {
  return {
    id: 'dsh',
    label: 'DeepSeek Harness',
    default: true,
    available: true,
    capabilities: {
      permission: true,
      approval: false,
      model: true,
      skills: true,
      fork: true,
      commands: true,
      jobs,
    },
    modelSource: 'pictor',
  }
}

function seed(jobs: boolean): void {
  useWorkspaceStore.setState({
    kernels: [kernel(jobs)],
    sessions: [
      {
        id: 's1',
        title: 's',
        projectId: null,
        kernelId: 'dsh',
        parentId: null,
        piSessionId: null,
        pinned: false,
        archived: false,
        sectionIds: [],
        createdAt: 0,
        updatedAt: 0,
      },
    ],
  } as never)
}

function job(overrides: Partial<ChatJob> & Pick<ChatJob, 'id'>): ChatJob {
  return {
    kind: 'bash',
    label: overrides.id,
    status: 'running',
    startedAt: 1,
    finishedAt: null,
    detail: null,
    ...overrides,
  }
}

/** Put one conversation's current states on screen. */
function show(state: {
  todos?: { content: string; status: 'pending' | 'in_progress' | 'completed' }[] | null
  plan?: { active: boolean; pending: boolean } | null
  jobs?: ChatJob[]
}): void {
  useChatStore.setState((current) => ({
    current: {
      ...current.current,
      sessionId: 's1',
      todos: state.todos === undefined ? null : state.todos,
      plan: state.plan === undefined ? null : state.plan,
      jobs: state.jobs ?? [],
    },
  }))
}

describe('SessionStateBar', () => {
  it('draws nothing for a conversation with none of the three', () => {
    // A Pi conversation keeps no todo list, no plan mode and no jobs: three empty
    // shells would promise controls that do not exist.
    seed(true)
    show({})

    const { container } = render(<SessionStateBar sessionId="s1" />)
    expect(container.firstChild).toBeNull()
  })

  it('summarises the todo list and opens it on demand', async () => {
    seed(true)
    show({
      todos: [
        { content: '读代码', status: 'completed' },
        { content: '写补丁', status: 'in_progress' },
        { content: '跑测试', status: 'pending' },
      ],
    })

    render(<SessionStateBar sessionId="s1" />)

    // Collapsed, the chip already names the step being worked on…
    const chip = screen.getByRole('button', { name: /任务 1\/3/ })
    expect(chip.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText('写补丁')).toBeTruthy()
    // …but the rest of the list is only there once asked for.
    expect(screen.queryByText('跑测试')).toBeNull()

    await userEvent.click(chip)
    expect(await screen.findByText('跑测试')).toBeTruthy()
    expect(chip.getAttribute('aria-expanded')).toBe('true')
  })

  it('badges plan mode only while it is on or switching', () => {
    seed(true)
    show({ plan: { active: true, pending: false } })
    render(<SessionStateBar sessionId="s1" />)
    expect(screen.getByText('计划模式 · 只读')).toBeTruthy()

    cleanup()
    // Turned off: a pill saying "read-only" would be the opposite of the truth.
    show({ plan: { active: false, pending: false } })
    const { container } = render(<SessionStateBar sessionId="s1" />)
    expect(container.firstChild).toBeNull()
  })

  it('counts running jobs and offers to stop them only where the kernel can', async () => {
    seed(true)
    show({ jobs: [job({ id: 'j1' }), job({ id: 'j2', status: 'completed' })] })
    render(<SessionStateBar sessionId="s1" />)

    await userEvent.click(screen.getByRole('button', { name: /后台任务 1 个运行中/ }))
    expect(screen.getByRole('button', { name: '停止 j1' })).toBeTruthy()
    // A finished job is history: no stop button, but its outcome is still readable.
    expect(screen.queryByRole('button', { name: '停止 j2' })).toBeNull()
    expect(screen.getByText(/已完成/)).toBeTruthy()

    cleanup()
    // Same conversation, kernel that cannot stop jobs: the roster still shows.
    seed(false)
    show({ jobs: [job({ id: 'j1' })] })
    render(<SessionStateBar sessionId="s1" />)
    await userEvent.click(screen.getByRole('button', { name: /后台任务 1 个运行中/ }))
    expect(screen.queryByRole('button', { name: '停止 j1' })).toBeNull()
  })
})
