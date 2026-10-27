// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Select } from './Select.js'

afterEach(() => {
  cleanup()
})

const OPTIONS = [
  { value: 'chat', label: 'Chat Completions' },
  { value: 'responses', label: 'Responses' },
]

describe('Select', () => {
  it('opens a themed listbox instead of the native popup', async () => {
    render(<Select value="chat" onChange={() => undefined} options={OPTIONS} aria-label="风格" />)

    await userEvent.click(screen.getByRole('combobox', { name: '风格' }))

    const listbox = screen.getByRole('listbox', { name: '风格' })

    // Portalled, so the field's container cannot clip the list.
    expect(listbox.parentElement).toBe(document.body)
    expect(screen.getAllByRole('option')).toHaveLength(2)
    expect(
      screen.getByRole('option', { name: 'Chat Completions' }).getAttribute('aria-selected'),
    ).toBe('true')
  })

  it('reports the chosen value and closes', async () => {
    const onChange = vi.fn()
    render(<Select value="chat" onChange={onChange} options={OPTIONS} aria-label="风格" />)

    await userEvent.click(screen.getByRole('combobox', { name: '风格' }))
    await userEvent.click(screen.getByRole('option', { name: 'Responses' }))

    expect(onChange).toHaveBeenCalledWith('responses')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('walks the options with the keyboard', async () => {
    const onChange = vi.fn()
    render(<Select value="chat" onChange={onChange} options={OPTIONS} aria-label="风格" />)

    const trigger = screen.getByRole('combobox', { name: '风格' })
    trigger.focus()

    await userEvent.keyboard('{Enter}')
    expect(screen.queryByRole('listbox')).not.toBeNull()

    await userEvent.keyboard('{ArrowDown}{Enter}')

    expect(onChange).toHaveBeenCalledWith('responses')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('closes on Escape without changing the value', async () => {
    const onChange = vi.fn()
    render(<Select value="chat" onChange={onChange} options={OPTIONS} aria-label="风格" />)

    await userEvent.click(screen.getByRole('combobox', { name: '风格' }))
    await userEvent.keyboard('{Escape}')

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
