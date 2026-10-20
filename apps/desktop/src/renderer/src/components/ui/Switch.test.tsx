// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Switch } from './Switch.js'

afterEach(() => {
  cleanup()
})

describe('Switch', () => {
  it('reports its state through role=switch', () => {
    render(<Switch label="启用插件" checked={false} onChange={() => undefined} />)

    expect(screen.getByRole('switch', { name: '启用插件' }).getAttribute('aria-checked')).toBe(
      'false',
    )
  })

  it('requests the opposite value when clicked', async () => {
    const onChange = vi.fn()
    render(<Switch label="启用插件" checked onChange={onChange} />)

    await userEvent.click(screen.getByRole('switch', { name: '启用插件' }))

    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('ignores clicks while disabled', async () => {
    const onChange = vi.fn()
    render(<Switch label="启用插件" checked={false} disabled onChange={onChange} />)

    await userEvent.click(screen.getByRole('switch', { name: '启用插件' }))

    expect(onChange).not.toHaveBeenCalled()
  })
})
