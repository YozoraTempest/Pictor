import { ArrowLeft, ArrowRight, Menu as MenuIcon } from 'lucide-react'

import type { WindowCommand } from '../../../shared/bridge.js'
import { openView } from '../app/open-view.js'
import { useUiStore } from '../app/ui-store.js'
import { sortedViews } from '../app/views.js'
import { useWorkspaceStore } from '../app/workspace-store.js'
import { Menu, Tooltip, type MenuEntry } from '../components/ui/index.js'

function newSessionTitle(): string {
  const now = new Date()
  return `新会话 ${now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
}

/** Sends a command to the main process, which owns the window. */
export function useWindowCommand(): (name: WindowCommand) => void {
  return (name: WindowCommand): void => {
    void window.pictor.windowCommand(name)
  }
}

/**
 * One overflow menu instead of a menu bar.
 *
 * A frameless window has no OS menu to fall back on, and a row of always-visible
 * labels costs more attention than it earns: the same groups live behind a single
 * trigger, each opening its own second-level list.
 */
function useAppMenu(): MenuEntry[] {
  const view = useUiStore((state) => state.view)
  const leftPanelOpen = useUiStore((state) => state.leftPanelOpen)
  const toggleLeftPanel = useUiStore((state) => state.toggleLeftPanel)
  const rightPanelOpen = useUiStore((state) => state.rightPanelOpen)
  const toggleRightPanel = useUiStore((state) => state.toggleRightPanel)

  const views = sortedViews()
  const info = useWorkspaceStore((state) => state.info)
  const createSession = useWorkspaceStore((state) => state.createSession)
  const addProject = useWorkspaceStore((state) => state.addProject)
  const setNotice = useWorkspaceStore((state) => state.setNotice)
  const command = useWindowCommand()

  return [
    {
      label: '文件',
      children: [
        {
          label: '新建聊天',
          shortcut: 'Ctrl+N',
          onSelect: () => void createSession(newSessionTitle(), null),
        },
        { label: '添加项目', onSelect: () => void addProject() },
        'separator',
        { label: '关闭窗口', shortcut: 'Ctrl+W', danger: true, onSelect: () => command('close') },
      ],
    },
    {
      label: '编辑',
      children: [
        { label: '撤销', shortcut: 'Ctrl+Z', onSelect: () => command('undo') },
        { label: '重做', shortcut: 'Ctrl+Shift+Z', onSelect: () => command('redo') },
        'separator',
        { label: '剪切', shortcut: 'Ctrl+X', onSelect: () => command('cut') },
        { label: '复制', shortcut: 'Ctrl+C', onSelect: () => command('copy') },
        { label: '粘贴', shortcut: 'Ctrl+V', onSelect: () => command('paste') },
        { label: '全选', shortcut: 'Ctrl+A', onSelect: () => command('selectAll') },
      ],
    },
    {
      label: '视图',
      children: [
        ...views.map((entry) => ({
          label: entry.label,
          checked: view === entry.id,
          shortcut: entry.shortcut,
          onSelect: () => openView(entry.id),
        })),
        {
          label: '显示侧栏',
          checked: leftPanelOpen,
          shortcut: 'Ctrl+B',
          onSelect: toggleLeftPanel,
        },
        { label: '显示面板', checked: rightPanelOpen, onSelect: toggleRightPanel },
        'separator',
        { label: '放大', shortcut: 'Ctrl+=', onSelect: () => command('zoomIn') },
        { label: '缩小', shortcut: 'Ctrl+-', onSelect: () => command('zoomOut') },
        { label: '实际大小', shortcut: 'Ctrl+0', onSelect: () => command('zoomReset') },
      ],
    },
    {
      label: '帮助',
      children: [
        {
          label: '关于 Pictor',
          onSelect: () =>
            setNotice(
              info === null
                ? 'Pictor'
                : `Pictor ${info.version} · Electron ${info.electron} · host-core ${info.hostCore}`,
            ),
        },
        'separator',
        { label: '重新加载', onSelect: () => command('reload') },
        { label: '开发者工具', onSelect: () => command('toggleDevTools') },
      ],
    },
  ]
}

/**
 * The tools every view shares: history and the overflow menu.
 *
 * They are injected into a view's own toolbar rather than pinned to a corner, so
 * a view can decide which side of the title they sit on without the shell having
 * to know anything about that view's layout.
 */
export function GlobalTools(): React.JSX.Element {
  const setView = useUiStore((state) => state.setView)
  const history = useUiStore((state) => state.history)
  const historyIndex = useUiStore((state) => state.historyIndex)
  const stepHistory = useUiStore((state) => state.stepHistory)
  const selectSession = useWorkspaceStore((state) => state.selectSession)
  const appMenu = useAppMenu()

  const canGoBack = historyIndex > 0
  const canGoForward = historyIndex >= 0 && historyIndex < history.length - 1

  function go(direction: -1 | 1): void {
    const location = stepHistory(direction)
    if (location === null) return

    setView(location.view)
    selectSession(location.sessionId)
  }

  return (
    <div className="app-no-drag flex items-center gap-0.5">
      <Tooltip label="返回" side="bottom" align="start">
        <button
          type="button"
          aria-label="返回"
          disabled={!canGoBack}
          onClick={() => {
            go(-1)
          }}
          className="grid size-7 place-items-center rounded-sm text-faint transition-colors duration-150 hover:bg-surface-hover hover:text-text disabled:pointer-events-none disabled:opacity-30"
        >
          <ArrowLeft className="size-3.5" />
        </button>
      </Tooltip>

      <Tooltip label="前进" side="bottom" align="start">
        <button
          type="button"
          aria-label="前进"
          disabled={!canGoForward}
          onClick={() => {
            go(1)
          }}
          className="grid size-7 place-items-center rounded-sm text-faint transition-colors duration-150 hover:bg-surface-hover hover:text-text disabled:pointer-events-none disabled:opacity-30"
        >
          <ArrowRight className="size-3.5" />
        </button>
      </Tooltip>

      <Menu
        label="更多"
        trigger={<MenuIcon className="size-3.5" />}
        triggerClassName="size-7"
        items={appMenu}
        align="left"
      />
    </div>
  )
}
