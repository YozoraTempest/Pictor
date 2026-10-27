// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ViewSpec } from '../../../../shared/bridge.js'

import { PluginViewPanel } from './PluginViewPanel.js'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** Stands in for the bridge; the panel only ever talks to this one method. */
function bridge(answer: (id: string) => Promise<ViewSpec>): ReturnType<typeof vi.fn> {
  const renderPluginView = vi.fn((id: string) => answer(id))
  vi.stubGlobal('pictor', { renderPluginView })
  return renderPluginView
}

/**
 * Stands in for the bridge when a panel both reads and handles presses. The press answer is
 * whatever the test hands back: a new description, or null for "nothing changed".
 */
function actions(
  shown: ViewSpec,
  press: (action: string, value: string | undefined) => Promise<ViewSpec | null>,
): ReturnType<typeof vi.fn> {
  const actPluginView = vi.fn(
    (_id: string, action: string, value: string | undefined): Promise<ViewSpec | null> =>
      press(action, value),
  )
  vi.stubGlobal('pictor', { renderPluginView: () => Promise.resolve(shown), actPluginView })
  return actPluginView
}

const spec: ViewSpec = {
  blocks: [
    { kind: 'heading', text: '今天要做的' },
    { kind: 'list', items: ['读代码', '写补丁'], ordered: true },
    { kind: 'badge', label: '2 项', tone: 'accent' },
  ],
  note: '读取于 12:00',
}

/** The column hands the panel its two ways out; tests that do not press them pass fakes. */
function panel(overrides: Partial<Parameters<typeof PluginViewPanel>[0]> = {}): React.JSX.Element {
  return (
    <PluginViewPanel
      view="acme.today"
      title="今日"
      sessionId="s1"
      onBack={() => {}}
      onClose={() => {}}
      {...overrides}
    />
  )
}

describe('PluginViewPanel', () => {
  it('draws the description the plugin returned', async () => {
    bridge(() => Promise.resolve(spec))
    render(panel())

    expect(await screen.findByText('今天要做的')).toBeTruthy()
    expect(screen.getByText('读代码')).toBeTruthy()
    expect(screen.getByText('2 项')).toBeTruthy()
    // The note is the plugin's own words about its data, so it is drawn under the blocks.
    expect(screen.getByText('读取于 12:00')).toBeTruthy()
  })

  it('asks for the view of the conversation it was opened over', async () => {
    const render0 = bridge(() => Promise.resolve(spec))
    render(panel())
    await screen.findByText('今天要做的')

    expect(render0).toHaveBeenCalledWith('acme.today', 's1')
  })

  it('shows the failure instead of an empty panel', async () => {
    // A panel that drew nothing would look like a plugin with nothing to say.
    bridge(() => Promise.reject(new Error('视图「今日」没有产出内容：boom')))
    render(panel({ sessionId: null }))

    expect(await screen.findByText(/没有产出内容：boom/)).toBeTruthy()
  })

  it('drops the previous content when a refresh fails', async () => {
    // Otherwise the last good answer stays on screen and reads as the current one.
    let reads = 0
    bridge(() => {
      reads += 1
      return reads === 1
        ? Promise.resolve(spec)
        : Promise.reject(new Error('视图「今日」没有产出内容：git 挂了'))
    })
    render(panel())
    await screen.findByText('今天要做的')

    await userEvent.click(screen.getByRole('button', { name: '刷新' }))

    expect(await screen.findByText(/git 挂了/)).toBeTruthy()
    expect(screen.queryByText('今天要做的')).toBeNull()
  })

  it('reads again when asked to refresh', async () => {
    let reads = 0
    const render0 = bridge(() => {
      reads += 1
      return Promise.resolve(
        reads === 1 ? spec : { blocks: [{ kind: 'text', text: '刷新后的内容' }] },
      )
    })
    render(panel({ sessionId: null }))
    await screen.findByText('今天要做的')

    await userEvent.click(screen.getByRole('button', { name: '刷新' }))

    expect(await screen.findByText('刷新后的内容')).toBeTruthy()
    await waitFor(() => expect(render0).toHaveBeenCalledTimes(2))
  })

  it('draws what a button press answered, replacing what it had', async () => {
    const act = actions(
      { blocks: [{ kind: 'button', label: '重新检查', action: 'recheck' }] },
      () => Promise.resolve({ blocks: [{ kind: 'text', text: '按过了' }] }),
    )
    render(panel())
    await screen.findByRole('button', { name: '重新检查' })

    await userEvent.click(screen.getByRole('button', { name: '重新检查' }))

    expect(await screen.findByText('按过了')).toBeTruthy()
    // The press names the view and the action id only; the window runs no plugin code.
    expect(act).toHaveBeenCalledWith('acme.today', 'recheck', undefined, 's1')
    expect(screen.queryByRole('button', { name: '重新检查' })).toBeNull()
  })

  it('keeps the content when a press changed nothing visible', async () => {
    // Nulling the panel would blank it to prove the click was heard.
    actions({ blocks: [{ kind: 'button', label: '重新检查', action: 'recheck' }] }, () =>
      Promise.resolve(null),
    )
    render(panel())
    await screen.findByRole('button', { name: '重新检查' })

    await userEvent.click(screen.getByRole('button', { name: '重新检查' }))

    expect(screen.getByRole('button', { name: '重新检查' })).toBeTruthy()
  })

  it('says a press failed and keeps what it was showing', async () => {
    // The press is an extra thing that went wrong; the last answer is still the last truth.
    actions({ blocks: [{ kind: 'button', label: '重新检查', action: 'recheck' }] }, () =>
      Promise.reject(new Error('视图「今日」没有处理按钮：recheck')),
    )
    render(panel())
    await screen.findByRole('button', { name: '重新检查' })

    await userEvent.click(screen.getByRole('button', { name: '重新检查' }))

    expect(await screen.findByText(/没有处理按钮：recheck/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '重新检查' })).toBeTruthy()
  })

  it('offers the two ways out of the column', async () => {
    bridge(() => Promise.resolve(spec))
    const onBack = vi.fn()
    const onClose = vi.fn()
    render(panel({ onBack, onClose }))
    await screen.findByText('今天要做的')

    await userEvent.click(screen.getByRole('button', { name: '返回面板列表' }))
    await userEvent.click(screen.getByRole('button', { name: '收起面板' }))

    expect(onBack).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
