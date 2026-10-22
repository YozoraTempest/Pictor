// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '@pictor/shared'

import { useWorkspaceStore } from '../../app/workspace-store.js'
import { ProjectPicker } from './ProjectPicker.js'

function project(id: string, name: string, path: string): Project {
  return {
    id,
    name,
    path,
    folders: [],
    sectionId: null,
    position: 0,
    createdAt: 0,
    updatedAt: 0,
  }
}

const projects = [
  project('p1', 'Astra-Opensource', '/home/dev/Astra-Opensource'),
  project('p2', 'Astra-Paradox', '/home/dev/Astra-Paradox'),
]

beforeEach(() => {
  useWorkspaceStore.setState({ projects })
})

afterEach(() => {
  cleanup()
})

describe('ProjectPicker', () => {
  it('summarises the active project with its working directory', () => {
    render(<ProjectPicker projectId="p1" onChange={() => undefined} />)

    const trigger = screen.getByRole('button', { name: '选择项目' })
    expect(trigger.textContent).toContain('Astra-Opensource')
    expect(trigger.textContent).toContain('本地')
    expect(trigger.textContent).toContain('/home/dev/Astra-Opensource')
  })

  it('falls back to a label when the conversation has no project', () => {
    render(<ProjectPicker projectId={null} onChange={() => undefined} />)

    expect(screen.getByRole('button', { name: '选择项目' }).textContent).toContain('临时任务')
  })

  it('filters the list by name or path', async () => {
    render(<ProjectPicker projectId="p1" onChange={() => undefined} />)

    await userEvent.click(screen.getByRole('button', { name: '选择项目' }))
    expect(screen.getByRole('button', { name: /Astra-Paradox/ })).toBeTruthy()

    await userEvent.type(screen.getByRole('textbox', { name: '搜索项目' }), 'paradox')

    expect(screen.getByRole('button', { name: /Astra-Paradox/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Astra-Opensource/ })).toBeNull()
  })

  it('reports the picked project and the empty choice', async () => {
    const onChange = vi.fn()
    render(<ProjectPicker projectId="p1" onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: '选择项目' }))
    await userEvent.click(screen.getByRole('button', { name: /Astra-Paradox/ }))
    expect(onChange).toHaveBeenCalledWith('p2')

    await userEvent.click(screen.getByRole('button', { name: '选择项目' }))
    await userEvent.click(screen.getByRole('button', { name: '临时任务' }))
    expect(onChange).toHaveBeenCalledWith(null)
  })
})
