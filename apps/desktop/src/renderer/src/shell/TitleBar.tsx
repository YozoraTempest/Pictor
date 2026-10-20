import { Minus, PanelRight, Sparkles, Square, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { WindowCommand } from '../../../shared/bridge.js'
import { useUiStore } from '../app/ui-store.js'
import { useWorkspaceStore } from '../app/workspace-store.js'
import { Menu, type MenuEntry } from '../components/ui/index.js'
import { cn } from '../lib/cn.js'

function newSessionTitle(): string {
  const now = new Date()
  return `新会话 ${now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
}

export function TitleBar(): React.JSX.Element {
  const view = useUiStore((state) => state.view)
  const setView = useUiStore((state) => state.setView)
  const rightPanelOpen = useUiStore((state) => state.rightPanelOpen)
  const toggleRightPanel = useUiStore((state) => state.toggleRightPanel)

  const projects = useWorkspaceStore((state) => state.projects)
  const selectedProjectId = useWorkspaceStore((state) => state.selectedProjectId)
  const sessions = useWorkspaceStore((state) => state.sessions)
  const selectedSessionId = useWorkspaceStore((state) => state.selectedSessionId)
  const info = useWorkspaceStore((state) => state.info)
  const createSession = useWorkspaceStore((state) => state.createSession)
  const addProject = useWorkspaceStore((state) => state.addProject)
  const setNotice = useWorkspaceStore((state) => state.setNotice)

  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void window.pictor.getWindowState().then((state) => setMaximized(state.maximized))
    return window.pictor.onWindowState((state) => setMaximized(state.maximized))
  }, [])

  const project = projects.find((entry) => entry.id === selectedProjectId) ?? null
  const session = sessions.find((entry) => entry.id === selectedSessionId) ?? null

  const command = (name: WindowCommand): void => {
    void window.pictor.windowCommand(name)
  }

  const fileMenu: MenuEntry[] = [
    { label: '新建聊天', onSelect: () => void createSession(newSessionTitle(), null) },
    { label: '添加项目', onSelect: () => void addProject() },
    'separator',
    { label: '设置', onSelect: () => setView('settings') },
    'separator',
    { label: '退出', danger: true, onSelect: () => command('close') },
  ]

  const editMenu: MenuEntry[] = [
    { label: '撤销', onSelect: () => command('undo') },
    { label: '重做', onSelect: () => command('redo') },
    'separator',
    { label: '剪切', onSelect: () => command('cut') },
    { label: '复制', onSelect: () => command('copy') },
    { label: '粘贴', onSelect: () => command('paste') },
    { label: '全选', onSelect: () => command('selectAll') },
  ]

  const viewMenu: MenuEntry[] = [
    { label: '首页', checked: view === 'home', onSelect: () => setView('home') },
    { label: '设置', checked: view === 'settings', onSelect: () => setView('settings') },
    { label: '显示工具面板', checked: rightPanelOpen, onSelect: toggleRightPanel },
    'separator',
    { label: '重新加载', onSelect: () => command('reload') },
    { label: '开发者工具', onSelect: () => command('toggleDevTools') },
    'separator',
    { label: '放大', onSelect: () => command('zoomIn') },
    { label: '缩小', onSelect: () => command('zoomOut') },
    { label: '实际大小', onSelect: () => command('zoomReset') },
  ]

  const helpMenu: MenuEntry[] = [
    {
      label: '关于 Pictor',
      onSelect: () =>
        setNotice(
          info === null
            ? 'Pictor'
            : `Pictor ${info.version} · Electron ${info.electron} · host-core ${info.hostCore}`,
        ),
    },
  ]

  const textTrigger = 'h-7 w-auto grid-flow-col auto-cols-max gap-1 px-2 text-xs'

  return (
    <header className="app-drag flex h-9 shrink-0 items-center gap-1 border-b border-border bg-surface/60 pr-0 pl-2">
      <div className="app-no-drag flex items-center gap-1.5 pr-1">
        <div className="grid size-5 place-items-center rounded-sm bg-accent/15 text-accent">
          <Sparkles className="size-3" />
        </div>
        <span className="text-xs font-semibold tracking-wide">Pictor</span>
      </div>

      <div className="app-no-drag flex items-center gap-0.5">
        <Menu
          label="文件"
          trigger="文件"
          triggerClassName={textTrigger}
          align="left"
          items={fileMenu}
        />
        <Menu
          label="编辑"
          trigger="编辑"
          triggerClassName={textTrigger}
          align="left"
          items={editMenu}
        />
        <Menu
          label="视图"
          trigger="视图"
          triggerClassName={textTrigger}
          align="left"
          items={viewMenu}
        />
        <Menu
          label="帮助"
          trigger="帮助"
          triggerClassName={textTrigger}
          align="left"
          items={helpMenu}
        />
      </div>

      <div className="mx-2 h-4 w-px bg-border" />

      <p className="min-w-0 flex-1 truncate text-2xs text-faint">
        {view === 'settings' ? '设置' : (project?.name ?? '未选择项目')}
        {view === 'home' && session !== null && (
          <span className="text-muted"> / {session.title}</span>
        )}
      </p>

      {view === 'home' && (
        <button
          type="button"
          aria-label={rightPanelOpen ? '收起工具面板' : '展开工具面板'}
          onClick={toggleRightPanel}
          className={cn(
            'app-no-drag grid size-7 place-items-center rounded-sm transition-colors duration-150 hover:bg-surface-hover',
            rightPanelOpen ? 'text-muted hover:text-text' : 'text-faint',
          )}
        >
          <PanelRight className="size-3.5" />
        </button>
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
