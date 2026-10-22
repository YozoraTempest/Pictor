import {
  ArrowLeft,
  ArrowRight,
  Menu as MenuIcon,
  Minus,
  PanelLeft,
  PanelRight,
  Square,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'

import type { WindowCommand } from '../../../shared/bridge.js'
import { openView } from '../app/open-view.js'
import { useUiStore } from '../app/ui-store.js'
import { APP_VIEWS, sortedViews } from '../app/views.js'
import { useWorkspaceStore } from '../app/workspace-store.js'
import { Menu, Tooltip, type MenuEntry } from '../components/ui/index.js'
import { cn } from '../lib/cn.js'

function newSessionTitle(): string {
  const now = new Date()
  return `新会话 ${now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
}

function useWindowCommand(): (name: WindowCommand) => void {
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
          shortcut: 'shortcut' in entry ? entry.shortcut : undefined,
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
 * The window's title bar.
 *
 * It is pure chrome — drag region, panel switches, history and the overflow menu.
 * The breadcrumb comes from the active view's descriptor, so the header never has
 * to know what that view contains.
 */
export function TitleBar(): React.JSX.Element {
  const view = useUiStore((state) => state.view)
  const setView = useUiStore((state) => state.setView)
  const leftPanelOpen = useUiStore((state) => state.leftPanelOpen)
  const toggleLeftPanel = useUiStore((state) => state.toggleLeftPanel)
  const rightPanelOpen = useUiStore((state) => state.rightPanelOpen)
  const toggleRightPanel = useUiStore((state) => state.toggleRightPanel)
  const history = useUiStore((state) => state.history)
  const historyIndex = useUiStore((state) => state.historyIndex)
  const stepHistory = useUiStore((state) => state.stepHistory)

  const selectSession = useWorkspaceStore((state) => state.selectSession)
  const sidebarWidth = useUiStore((state) => state.sidebarWidth)
  const sidebarResizing = useUiStore((state) => state.sidebarResizing)
  const peekSidebar = useUiStore((state) => state.peekSidebar)

  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void window.pictor.getWindowState().then((state) => setMaximized(state.maximized))
    return window.pictor.onWindowState((state) => setMaximized(state.maximized))
  }, [])

  const active = APP_VIEWS.find((entry) => entry.id === view) ?? APP_VIEWS[0]
  const command = useWindowCommand()
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
    <header className="app-drag flex h-9 shrink-0 items-center bg-surface/60">
      {/*
        The tools sit in the header, but the strip they occupy matches the sidebar
        width while it is pinned: its right edge carries the divider, so the line
        runs on through the title bar and the title starts past it. Collapsed, the
        strip shrinks to the buttons, the divider goes away and the title slides
        left.
      */}
      <div
        className={cn(
          'app-no-drag flex h-full items-center gap-0.5 pl-1.5',
          leftPanelOpen && 'border-r border-border',
          !sidebarResizing && 'transition-[width] duration-300 ease-out',
        )}
        style={leftPanelOpen ? { width: sidebarWidth } : undefined}
      >
        <Tooltip
          label={leftPanelOpen ? '收起侧栏' : '悬停预览，点击展开侧栏'}
          side="bottom"
          align="start"
        >
          <button
            type="button"
            aria-label={leftPanelOpen ? '收起侧栏' : '展开侧栏'}
            onClick={toggleLeftPanel}
            onPointerEnter={() => peekSidebar(true)}
            onPointerLeave={() => peekSidebar(false)}
            className={cn(
              'grid size-7 place-items-center rounded-sm transition-colors duration-150 hover:bg-surface-hover',
              leftPanelOpen ? 'text-muted hover:text-text' : 'text-faint',
            )}
          >
            <PanelLeft className="size-3.5" />
          </button>
        </Tooltip>

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

      <p className="mx-2 min-w-0 flex-1 truncate text-2xs text-faint">{active.header?.()}</p>

      {/* The panel it controls sits on the right, so its switch lives there too. */}
      {view === 'home' && (
        <div className="app-no-drag flex items-center">
          <Tooltip
            label={rightPanelOpen ? '收起右侧面板' : '展开右侧面板'}
            side="bottom"
            align="end"
          >
            <button
              type="button"
              aria-label={rightPanelOpen ? '收起右侧面板' : '展开右侧面板'}
              onClick={toggleRightPanel}
              className={cn(
                'grid size-7 place-items-center rounded-sm transition-colors duration-150 hover:bg-surface-hover',
                rightPanelOpen ? 'text-muted hover:text-text' : 'text-faint',
              )}
            >
              <PanelRight className="size-3.5" />
            </button>
          </Tooltip>
        </div>
      )}

      <div className="app-no-drag ml-1 flex items-center">
        <button
          type="button"
          aria-label="最小化"
          onClick={() => command('minimize')}
          className="grid size-8 place-items-center text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text"
        >
          <Minus className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label={maximized ? '还原' : '最大化'}
          onClick={() => command('toggleMaximize')}
          className="grid size-8 place-items-center text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text"
        >
          <Square className={maximized ? 'size-3' : 'size-3.5'} />
        </button>
        <button
          type="button"
          aria-label="关闭"
          onClick={() => command('close')}
          className="grid size-8 place-items-center text-muted transition-colors duration-150 hover:bg-danger/80 hover:text-bg"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </header>
  )
}
