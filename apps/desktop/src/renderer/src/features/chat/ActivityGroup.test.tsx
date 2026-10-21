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
    render(
      <ActivityGroup
        messages={[call('x1', 'read'), call('x2', 'bash'), thinking('t1', '还在想')]}
        running
      />,
    )

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

    const header = screen.getByRole('button', { name: /^思考/ })
    expect(screen.queryByLabelText('已完成')).toBeNull()
    expect(screen.getByLabelText('仅思考')).toBeTruthy()
    expect(header.querySelector('svg.lucide-brain')).not.toBeNull()
  })
})

describe('a single call', () => {
  it('shows the call itself instead of a wrapping row', () => {
    render(<ActivityGroup messages={[call('x1', 'bash')]} running={false} />)

    // No summary row to open: the call is already the whole group.
    expect(screen.queryByRole('button', { name: /已运行 1 个工具/ })).toBeNull()

    const row = screen.getByRole('button', { name: /^运行/ })
    expect(row.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('输出')).toBeTruthy()
  })

  it('keeps the reasoning row alongside the call', () => {
    render(
      <ActivityGroup messages={[thinking('t1', '先读文件'), call('x1', 'read')]} running={false} />,
    )

    const rows = screen.getAllByRole('button', { name: /思考|阅读/ })
    expect(rows).toHaveLength(2)
    // The call is open by default; the reasoning stays folded.
    expect(rows[1]?.getAttribute('aria-expanded')).toBe('true')
    expect(rows[0]?.getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps the same frame a wrapped group uses', () => {
    const single = render(<ActivityGroup messages={[call('x1', 'bash')]} running={false} />)
    const singleFrame = single.container.firstElementChild?.className
    single.unmount()

    const many = render(
      <ActivityGroup messages={[call('x1', 'read'), call('x2', 'bash')]} running={false} />,
    )

    expect(singleFrame).toBe(many.container.firstElementChild?.className)
  })
})

describe('several calls', () => {
  it('wraps them in a row that folds, keeping each call closed', async () => {
    render(<ActivityGroup messages={[call('x1', 'read'), call('x2', 'bash')]} running={false} />)

    await userEvent.click(screen.getByRole('button', { name: /已运行 2 个工具/ }))

    for (const row of screen.getAllByRole('button', { name: /^(阅读|运行)/ })) {
      expect(row.getAttribute('aria-expanded')).toBe('false')
    }
  })

  it('lists reasoning and tool calls together when expanded', async () => {
    render(
      <ActivityGroup
        messages={[thinking('t1', '先读文件'), call('x1', 'read'), thinking('t2', '再运行')]}
        running={false}
      />,
    )

    // One call means the rows are bare — no outer row to open.
    const rows = screen.getAllByRole('button', { name: /思考|阅读/ })
    expect(rows.map((row) => row.textContent?.trim().slice(0, 2))).toEqual(['思考', '阅读', '思考'])

    expect(screen.queryByText('先读文件')).toBeNull()
    await userEvent.click(rows[0] as HTMLElement)
    expect(screen.getByText('先读文件')).toBeTruthy()
  })
})

describe('tool icons', () => {
  it('renders the icon the presenter registered for the tool', () => {
    render(<ActivityGroup messages={[call('x1', 'bash')]} running={false} />)

    const row = screen.getByRole('button', { name: /^运行/ })
    // Tool icon, status mark and the disclosure chevron.
    expect(row.querySelectorAll('svg')).toHaveLength(3)
    expect(row.querySelector('svg.lucide-terminal')).not.toBeNull()
  })

  it('leaves an unregistered tool with only its status mark', () => {
    render(<ActivityGroup messages={[call('x1', 'mystery')]} running={false} />)

    const row = screen.getByRole('button', { name: /^mystery/ })
    expect(row.querySelectorAll('svg')).toHaveLength(2)
  })
})
