// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The three panels are separate features with their own data; this test is about the
// shell — which tab is showing, and that there is exactly one name for the page.
vi.mock('../settings/PluginsSection.js', () => ({
  PluginsSection: () => <p>插件面板</p>,
}))
vi.mock('../settings/SkillsSection.js', () => ({
  SkillsSection: () => <p>技能面板</p>,
}))
vi.mock('../settings/McpSection.js', () => ({
  McpSection: () => <p>MCP 面板</p>,
}))

const { ExtensionsView } = await import('./ExtensionsView.js')

afterEach(() => {
  cleanup()
})

describe('ExtensionsView', () => {
  it('opens on the plugins, with the other two a click away', async () => {
    render(<ExtensionsView />)

    expect(screen.getByText('插件面板')).toBeTruthy()
    // Three surfaces, one page: the tabs are the navigation, so there is no third level.
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      '插件',
      '技能',
      'MCP',
    ])
    expect(screen.getByRole('tab', { name: '插件' }).getAttribute('aria-selected')).toBe('true')
  })

  it('swaps the panel when a tab is chosen', async () => {
    render(<ExtensionsView />)

    await userEvent.click(screen.getByRole('tab', { name: '技能' }))
    expect(screen.getByText('技能面板')).toBeTruthy()
    expect(screen.queryByText('插件面板')).toBeNull()

    await userEvent.click(screen.getByRole('tab', { name: 'MCP' }))
    expect(screen.getByText('MCP 面板')).toBeTruthy()
  })

  it('names the page once', async () => {
    // The panels behind the tabs used to carry a heading of their own, which put the
    // same word on screen twice: tab 「插件」 and section 「插件」.
    render(<ExtensionsView />)

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('拓展')
  })
})
