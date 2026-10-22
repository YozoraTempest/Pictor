// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { Tooltip } from './Tooltip.js'

afterEach(() => {
  cleanup()
})

describe('Tooltip', () => {
  it('exposes the label as a tooltip description', () => {
    render(
      <Tooltip label="由插件提供">
        <button type="button">插件</button>
      </Tooltip>,
    )

    expect(screen.getByRole('tooltip').textContent).toBe('由插件提供')
  })

  it('keeps the trigger focusable so the tooltip works without a mouse', async () => {
    render(
      <Tooltip label="展开面板" side="bottom" align="end">
        <button type="button">toggle</button>
      </Tooltip>,
    )

    await userEvent.tab()

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'toggle' }))
  })

  it('renders the bubble outside the anchor, so a clipping container cannot cut it', () => {
    render(
      <div style={{ overflow: 'hidden' }}>
        <Tooltip label="右侧控件" align="end">
          <button type="button">x</button>
        </Tooltip>
      </div>,
    )

    const bubble = screen.getByRole('tooltip')

    // The bubble used to be an absolutely positioned child, which is what made it
    // disappear behind cards and dialogs.
    expect(bubble.parentElement).toBe(document.body)
    expect(bubble.closest('div')).toBeNull()
  })

  it('shows the bubble while the trigger is hovered', async () => {
    render(
      <Tooltip label="提示">
        <button type="button">toggle</button>
      </Tooltip>,
    )

    const bubble = screen.getByRole('tooltip')
    const trigger = screen.getByRole('button', { name: 'toggle' })

    expect(bubble.className).toContain('opacity-0')

    await userEvent.hover(trigger)
    expect(bubble.className).toContain('opacity-100')

    await userEvent.unhover(trigger)
    expect(bubble.className).toContain('opacity-0')
  })
})
