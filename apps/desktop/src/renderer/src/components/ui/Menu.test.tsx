// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Menu, type MenuEntry } from './Menu.js'

afterEach(() => {
  cleanup()
})

const items: MenuEntry[] = [
  {
    label: '文件',
    children: [
      { label: '新建聊天', shortcut: 'Ctrl+N', onSelect: () => undefined },
      'separator',
      { label: '设置', shortcut: 'Ctrl+,', onSelect: () => undefined },
    ],
  },
  { label: '关于', onSelect: () => undefined },
]

describe('Menu', () => {
  it('opens the second level for a row that has children', async () => {
    render(<Menu label="更多" trigger={<span>≡</span>} items={items} />)

    await userEvent.click(screen.getByRole('button', { name: '更多' }))
    expect(screen.queryByRole('menu', { name: '文件' })).toBeNull()

    await userEvent.click(screen.getByRole('menuitem', { name: '文件' }))

    expect(screen.getByRole('menu', { name: '文件' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /新建聊天/ })).toBeTruthy()
  })

  it('runs a leaf action and closes the whole menu', async () => {
    const onSelect = vi.fn()
    render(<Menu label="更多" trigger={<span>≡</span>} items={[{ label: '关于', onSelect }]} />)

    await userEvent.click(screen.getByRole('button', { name: '更多' }))
    await userEvent.click(screen.getByRole('menuitem', { name: '关于' }))

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('shows the shortcut hint beside the label', async () => {
    render(<Menu label="更多" trigger={<span>≡</span>} items={items} />)

    await userEvent.click(screen.getByRole('button', { name: '更多' }))
    await userEvent.click(screen.getByRole('menuitem', { name: '文件' }))

    expect(screen.getByRole('menuitem', { name: /Ctrl\+N/ })).toBeTruthy()
  })
})
