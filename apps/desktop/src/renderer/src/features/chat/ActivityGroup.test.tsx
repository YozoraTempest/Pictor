// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import type { ChatMessage } from '@pictor/shared'

import { ActivityGroup } from './ActivityGroup.js'

afterEach(() => {
  cleanup()
})

function msg(partial: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'role'>): ChatMessage {
  return { text: '', timestamp: null, ...partial }
}

function thinking(id: string, text: string): ChatMessage {
  return msg({ id, role: 'assistant', kind: 'thinking', text })
}

function call(id: string, toolName: string): ChatMessage {
  return msg({ id, role: 'tool', toolName, text: 'ok' })
}

describe('ActivityGroup', () => {
  it('says the agent is thinking while reasoning is the newest thing', () => {
    render(<ActivityGroup messages={[call('x1', 'read'), thinking('t1', '还在想')]} running />)

    expect(screen.getByRole('button', { name: /正在思考/ })).toBeTruthy()
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy()
  })

  it('counts the calls once the trail is done', () => {
    render(<ActivityGroup messages={[call('x1', 'read'), call('x2', 'bash')]} running={false} />)

    const header = screen.getByRole('button', { name: /已运行 2 个工具/ })
    expect(within(header).getByLabelText('已完成')).toBeTruthy()
  })

  it('does not claim tool work for a reasoning-only trail', () => {
    render(<ActivityGroup messages={[thinking('t1', '只想了')]} running={false} />)

    expect(screen.getByRole('button', { name: /思考过程/ })).toBeTruthy()
    expect(screen.queryByLabelText('已完成')).toBeNull()
    expect(screen.getByLabelText('仅思考')).toBeTruthy()
  })

  it('lists reasoning and tool calls together when expanded', async () => {
    render(
      <ActivityGroup
        messages={[thinking('t1', '先读文件'), call('x1', 'read'), thinking('t2', '再运行')]}
        running={false}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /已运行 1 个工具/ }))

    const rows = screen.getAllByRole('button', { name: /思考过程|阅读/ })
    expect(rows.map((row) => row.textContent?.trim().slice(0, 3))).toEqual([
      '思考过',
      '阅读',
      '思考过',
    ])

    // Reasoning bodies stay folded until asked for.
    expect(screen.queryByText('先读文件')).toBeNull()
    await userEvent.click(rows[0] as HTMLElement)
    expect(screen.getByText('先读文件')).toBeTruthy()
  })
})
