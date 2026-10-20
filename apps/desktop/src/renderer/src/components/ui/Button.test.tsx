// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Button, IconButton } from './Button.js'

afterEach(() => {
  cleanup()
})

describe('Button', () => {
  it('renders its label and forwards clicks', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>保存</Button>)

    await userEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not fire while disabled', async () => {
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        保存
      </Button>,
    )

    await userEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(onClick).not.toHaveBeenCalled()
  })

  it('defaults to type=button so it never submits a surrounding form', () => {
    render(<Button>确定</Button>)

    expect(screen.getByRole('button', { name: '确定' })).toHaveProperty('type', 'button')
  })
})

describe('IconButton', () => {
  it('exposes its label to assistive technology', () => {
    render(
      <IconButton label="关闭面板">
        <span aria-hidden="true">x</span>
      </IconButton>,
    )

    expect(screen.getByRole('button', { name: '关闭面板' })).toHaveProperty('title', '关闭面板')
  })
})
