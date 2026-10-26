// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ChatMessage } from '@pictor/shared'

import { TurnBlock } from './TurnBlock.js'
import { buildTurns } from './turns.js'

afterEach(() => {
  cleanup()
})

function msg(partial: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'role'>): ChatMessage {
  return { text: '', timestamp: null, ...partial }
}

/** Two turns, so the second one has something to go back to. */
function turns() {
  return buildTurns([
    msg({ id: 'u1', role: 'user', text: '第一问', seq: 4 }),
    msg({ id: 'a1', role: 'assistant', text: '第一答', seq: 7 }),
    msg({ id: 'u2', role: 'user', text: '第二问', seq: 9 }),
    msg({ id: 'a2', role: 'assistant', text: '第二答', seq: 12 }),
  ])
}

function renderTurn(index: number, onRewind?: (point: { seq?: number; id?: string }) => void) {
  const turn = turns()[index]
  if (turn === undefined) throw new Error('missing turn')
  render(
    <TurnBlock
      turn={turn}
      live={false}
      phase="idle"
      currentTool={null}
      {...(onRewind === undefined ? {} : { onRewind })}
    />,
  )
}

describe('TurnBlock rewind', () => {
  it('offers to go back to before a turn that has something before it', async () => {
    const onRewind = vi.fn()
    renderTurn(1, onRewind)

    await userEvent.click(screen.getByRole('button', { name: '回到这一问之前' }))

    // The point is the boundary the previous turn ended on: rewinding to before turn 2
    // means keeping turn 1 whole.
    expect(onRewind).toHaveBeenCalledWith({ seq: 7 })
  })

  it('offers nothing on the first turn', () => {
    // "Back to before the first question" is an empty conversation, which is what
    // starting a new one already is.
    renderTurn(0, vi.fn())

    expect(screen.queryByRole('button', { name: '回到这一问之前' })).toBeNull()
  })

  it('draws no rewind at all where the kernel cannot branch', () => {
    renderTurn(1)

    expect(screen.queryByRole('button', { name: '回到这一问之前' })).toBeNull()
  })
})
