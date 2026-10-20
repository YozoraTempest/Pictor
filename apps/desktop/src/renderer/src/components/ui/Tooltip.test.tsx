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

  it('aligns the bubble to the end edge instead of the centre', () => {
    render(
      <Tooltip label="右侧控件" align="end">
        <button type="button">x</button>
      </Tooltip>,
    )

    const bubble = screen.getByRole('tooltip')
    expect(bubble.className).toContain('right-0')
    expect(bubble.className).not.toContain('left-1/2')
  })
})
