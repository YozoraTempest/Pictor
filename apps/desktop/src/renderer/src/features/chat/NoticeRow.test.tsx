// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { NoticeRow } from './NoticeRow.js'

afterEach(() => {
  cleanup()
})

describe('NoticeRow', () => {
  it('says what was compacted and how much it saved', async () => {
    render(
      <NoticeRow notice={{ kind: 'compaction', savedTokens: 42_000, summary: '前面聊过颜色' }} />,
    )

    const trigger = screen.getByRole('button', { name: /上下文已压缩/ })
    expect(trigger.textContent).toContain('省下 42k tokens')
    // Collapsed by default: the transcript stays a transcript until someone asks.
    expect(screen.queryByText('前面聊过颜色')).toBeNull()

    await userEvent.click(trigger)
    expect(await screen.findByText('前面聊过颜色')).toBeTruthy()
  })

  it('draws no count and no summary when the kernel reported neither', () => {
    render(<NoticeRow notice={{ kind: 'compaction', savedTokens: null, summary: '' }} />)

    const trigger = screen.getByRole('button', { name: /上下文已压缩/ })
    expect(trigger.textContent).not.toContain('省下')
    // Nothing to expand: a button that opens an empty box would be a lie about content.
    expect(trigger).toHaveProperty('disabled', true)
    expect(trigger.getAttribute('aria-expanded')).toBeNull()
  })
})
