// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Panel } from './Panel.js'

afterEach(() => {
  cleanup()
})

describe('Panel', () => {
  it('renders header content when a title is given', () => {
    render(
      <Panel title="模型服务" description="端点与密钥" actions={<button>编辑</button>}>
        <p>正文</p>
      </Panel>,
    )

    expect(screen.getByRole('heading', { name: '模型服务' })).toBeTruthy()
    expect(screen.getByText('端点与密钥')).toBeTruthy()
    expect(screen.getByRole('button', { name: '编辑' })).toBeTruthy()
    expect(screen.getByText('正文')).toBeTruthy()
  })

  it('omits the header entirely when nothing is passed', () => {
    const { container } = render(
      <Panel>
        <p>只有正文</p>
      </Panel>,
    )

    expect(container.querySelector('header')).toBeNull()
    expect(screen.getByText('只有正文')).toBeTruthy()
  })

  it('keeps a description-only header', () => {
    render(
      <Panel description="仅说明">
        <p>正文</p>
      </Panel>,
    )

    expect(screen.getByText('仅说明')).toBeTruthy()
  })
})
