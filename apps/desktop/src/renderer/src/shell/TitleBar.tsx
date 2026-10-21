import { Menu as MenuIcon, Minus, PanelLeft, PanelRight, Square, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { WindowCommand } from '../../../shared/bridge.js'
import { useUiStore } from '../app/ui-store.js'
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
 * A frameless window has no OS menu to fall back on, and four always-visible
 * labels cost more attention than they earn: the same items live behind a single
 * trigger, grouped by the separator lines the old menus used to draw.
 */
function useAppMenu(): MenuEntry[] {
  const view = useUiStore((state) => state.view)
  const setView = useUiStore((state) => state.setView)
  const leftPanelOpen = useUiStore((state) => state.leftPanelOpen)
  const toggleLeftPanel = useUiStore((state) => state.toggleLeftPanel)
  const rightPanelOpen = useUiStore((state) => state.rightPanelOpen)
  const toggleRightPanel = useUiStore((state) => state.toggleRightPanel)

  const info = useWorkspaceStore((state) => state.info)
  const createSession = useWorkspaceStore((state) => state.createSession)
  const addProject = useWorkspaceStore((state) => state.addProject)
  const setNotice = useWorkspaceStore((state) => state.setNotice)
  const command = useWindowCommand()

  return [
    { label: '新建聊天', onSelect: () => void createSession(newSessionTitle(), null) },
    { label: '添加项目', onSelect: () => void addProject() },
    { label: '设置', onSelect: () => setView('settings') },
    'separator',
    { label: '撤销', onSelect: () => command('undo') },
    { label: '重做', onSelect: () => command('redo') },
    { label: '剪切', onSelect: () => command('cut') },
    { label: '复制', onSelect: () => command('copy') },
    { label: '粘贴', onSelect: () => command('paste') },
    { label: '全选', onSelect: () => command('selectAll') },
    'separator',
    { label: '首页', checked: view === 'home', onSelect: () => setView('home') },
    { label: '显示侧栏', checked: leftPanelOpen, onSelect: toggleLeftPanel },
    { label: '显示面板', checked: rightPanelOpen, onSelect: toggleRightPanel },
    'separator',
    { label: '重新加载', onSelect: () => command('reload') },
    { label: '开发者工具', onSelect: () => command('toggleDevTools') },
    { label: '放大', onSelect: () => command('zoomIn') },
    { label: '缩小', onSelect: () => command('zoomOut') },
    { label: '实际大小', onSelect: () => command('zoomReset') },
    'separator',
    {
      label: '关于 Pictor',
      onSelect: () =>
        setNotice(
          info === null
            ? 'Pictor'
            : `Pictor ${info.version} · Electron ${info.electron} · host-core ${info.hostCore}`,
        ),
    },
    { label: '退出', danger: true, onSelect: () => command('close') },
  ]
}

/** The app menu plus the sidebar switch — the tools that live over the sidebar. */
function PanelTools(): React.JSX.Element {
  const appMenu = useAppMenu()
  const leftPanelOpen = useUiStore((state) => state.leftPanelOpen)
  const toggleLeftPanel = useUiStore((state) => state.toggleLeftPanel)

  return (
    <div className="app-no-drag flex items-center gap-0.5">
      <Menu
        label="菜单"
        trigger={<MenuIcon className="size-3.5" />}
        triggerClassName="size-7"
        items={appMenu}
        align="left"
      />

      <Tooltip label={leftPanelOpen ? '收起侧栏' : '展开侧栏'} side="bottom" align="start">
        <button
          type="button"
          aria-label={leftPanelOpen ? '收起侧栏' : '展开侧栏'}
          onClick={toggleLeftPanel}
          className={cn(
            'grid size-7 place-items-center rounded-sm transition-colors duration-150 hover:bg-surface-hover',
            leftPanelOpen ? 'text-muted hover:text-text' : 'text-faint',
          )}
        >
          <PanelLeft className="size-3.5" />
        </button>
      </Tooltip>
    </div>
  )
}

/**
 * Toolbar above the sidebar. It shares the title bar's height and background, so
 * the top strip reads as one bar that the sidebar's divider cuts through — with
 * no horizontal line between the tools and the panel below them.
 */
export function SidebarTools(): React.JSX.Element {
  return (
    <div className="app-drag flex h-9 shrink-0 items-center bg-surface/60 pl-1.5">
      <PanelTools />
    </div>
  )
}

export function TitleBar(): React.JSX.Element {
  const view = useUiStore((state) => state.view)
  const leftPanelOpen = useUiStore((state) => state.leftPanelOpen)
  const rightPanelOpen = useUiStore((state) => state.rightPanelOpen)
  const toggleRightPanel = useUiStore((state) => state.toggleRightPanel)

  const projects = useWorkspaceStore((state) => state.projects)
  const selectedProjectId = useWorkspaceStore((state) => state.selectedProjectId)
  const sessions = useWorkspaceStore((state) => state.sessions)
  const selectedSessionId = useWorkspaceStore((state) => state.selectedSessionId)

  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void window.pictor.getWindowState().then((state) => setMaximized(state.maximized))
    return window.pictor.onWindowState((state) => setMaximized(state.maximized))
  }, [])

  const project = projects.find((entry) => entry.id === selectedProjectId) ?? null
  const session = sessions.find((entry) => entry.id === selectedSessionId) ?? null
  const command = useWindowCommand()

  // With the sidebar open, its toolbar (menu + switch) sits above the panel and
  // the header carries only the title. Once the sidebar is gone — collapsed, or
  // on the settings view — the tools fall back here so they stay reachable.
  const showTools = view !== 'home' || !leftPanelOpen

  return (
    <header className="app-drag flex h-9 shrink-0 items-center gap-1 border-b border-border bg-surface/60 pl-1.5">
      {showTools && <PanelTools />}
      {showTools && <div className="mx-2 h-4 w-px bg-border" />}

      <p className={cn('min-w-0 flex-1 truncate text-2xs text-faint', !showTools && 'ml-1')}>
        {view === 'settings' ? '设置' : (project?.name ?? '未选择项目')}
        {view === 'home' && session !== null && (
          <span className="text-muted"> / {session.title}</span>
        )}
      </p>

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
