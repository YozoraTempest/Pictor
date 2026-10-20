import { useMemo } from 'react'
import { X } from 'lucide-react'

import { useUiStore } from '../app/ui-store.js'
import { useWorkspaceStore } from '../app/workspace-store.js'
import { IconButton } from '../components/ui/index.js'
import {
  createBuiltinPanels,
  mergePanels,
  pluginPanelEntries,
  type PanelEntry,
} from '../features/panels/registry.js'

function PanelRow({ panel }: { panel: PanelEntry }): React.JSX.Element {
  const Icon = panel.icon

  return (
    <li>
      <button
        type="button"
        onClick={panel.run}
        className="group flex w-full items-center gap-2.5 rounded-md border border-border bg-surface px-2.5 py-2 text-left transition-colors duration-150 hover:border-border-strong hover:bg-surface-hover"
      >
        <Icon className="size-3.5 shrink-0 text-muted group-hover:text-text" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs text-text">{panel.title}</span>
          {panel.description.length > 0 && (
            <span className="block truncate text-2xs text-faint">{panel.description}</span>
          )}
        </span>
        {panel.source === 'plugin' && <span className="shrink-0 text-2xs text-faint">插件</span>}
      </button>
    </li>
  )
}

/**
 * The right panel is an extension surface: built-in panels and plugin panels are
 * merged into one list, so a plugin contribution renders exactly like a panel
 * that ships with the workbench.
 */
export function RightPanel(): React.JSX.Element {
  const toggleRightPanel = useUiStore((state) => state.toggleRightPanel)
  const setView = useUiStore((state) => state.setView)
  const createSession = useWorkspaceStore((state) => state.createSession)
  const invokePanel = useWorkspaceStore((state) => state.invokePanel)
  const pluginPanels = useWorkspaceStore((state) => state.panels)

  const panels = useMemo(
    () =>
      mergePanels(
        createBuiltinPanels({
          createSession: () => {
            void createSession(
              `新会话 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`,
            )
          },
          openSettings: () => setView('settings'),
        }),
        pluginPanelEntries(pluginPanels, (id, title) => {
          void invokePanel(id, title)
        }),
      ),
    [createSession, invokePanel, pluginPanels, setView],
  )

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden border-l border-border bg-surface/30">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border pr-2 pl-3">
        <h2 className="text-2xs font-semibold tracking-wider text-faint uppercase">面板</h2>
        <IconButton label="收起面板" className="size-7" onClick={toggleRightPanel}>
          <X className="size-3.5" />
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
        <ul className="flex flex-col gap-1.5">
          {panels.map((panel) => (
            <PanelRow key={panel.id} panel={panel} />
          ))}
        </ul>
      </div>
    </aside>
  )
}
