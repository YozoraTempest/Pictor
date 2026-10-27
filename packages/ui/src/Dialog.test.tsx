// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Dialog } from './Dialog.js'

afterEach(() => {
  cleanup()
})

describe('Dialog', () => {
  it('renders nothing while closed', () => {
    render(
      <Dialog open={false} title="模型设置" onClose={() => undefined}>
        内容
      </Dialog>,
    )

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('exposes a modal dialog with its title and content', () => {
    render(
      <Dialog open title="模型设置" onClose={() => undefined}>
        内容
      </Dialog>,
    )

    const dialog = screen.getByRole('dialog', { name: '模型设置' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.textContent).toContain('内容')
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    render(
      <Dialog open title="模型设置" onClose={onClose}>
        内容
      </Dialog>,
    )

    await userEvent.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes when the close button is pressed', async () => {
    const onClose = vi.fn()
    render(
      <Dialog open title="模型设置" onClose={onClose}>
        内容
      </Dialog>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
