import { useMemo } from 'react'
import { X } from 'lucide-react'

import { openView } from '../app/open-view.js'
import { useUiStore } from '../app/ui-store.js'
import { useWorkspaceStore } from '../app/workspace-store.js'
import { IconButton, Tooltip } from '../components/ui/index.js'
import {
  createBuiltinPanels,
  mergePanels,
  pluginPanelEntries,
  type PanelEntry,
} from '../features/panels/registry.js'
import { PluginViewPanel } from '../features/panels/PluginViewPanel.js'

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
        {panel.source === 'plugin' && (
          <Tooltip label="由插件提供" align="end">
            <span className="text-2xs text-faint">插件</span>
          </Tooltip>
        )}
      </button>
    </li>
  )
}

/**
 * The right panel is an extension surface: built-in panels and plugin panels are
 * merged into one list, so a plugin contribution renders exactly like a panel
 * that ships with the workbench.
 *
 * A plugin panel is a frame: opening one swaps the list for the view it names, which the
 * renderer draws from a validated description. Going back is one button, because this
 * column is one gesture deep — a second level of navigation here would compete with the
 * conversation rather than serve it.
 */
export function RightPanel(): React.JSX.Element {
  const toggleRightPanel = useUiStore((state) => state.toggleRightPanel)
  const createSession = useWorkspaceStore((state) => state.createSession)
  const pluginPanels = useWorkspaceStore((state) => state.panels)
  const selectedSessionId = useWorkspaceStore((state) => state.selectedSessionId)
  const openPanel = useUiStore((state) => state.openPanel)
  const openPanelNamed = useUiStore((state) => state.openPanelNamed)
  const closePanel = useUiStore((state) => state.closePanel)

  const panels = useMemo(
    () =>
      mergePanels(
        createBuiltinPanels({
          createSession: () => {
            void createSession(
              `新会话 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`,
            )
          },
          openSettings: () => openView('settings'),
        }),
        pluginPanelEntries(pluginPanels, (panel) => openPanelNamed(panel.id)),
      ),
    [createSession, openPanelNamed, pluginPanels],
  )

  // The open panel can disappear while it is showing — a plugin was disabled, say. The
  // list is then the only honest thing left to draw.
  const shown = openPanel === null ? undefined : panels.find((panel) => panel.id === openPanel)

  if (shown !== undefined && shown.view !== undefined) {
    return (
      <aside className="flex min-h-0 flex-col overflow-hidden border-l border-border bg-surface/30">
        <PluginViewPanel
          view={shown.view}
          title={shown.title}
          sessionId={selectedSessionId}
          onBack={closePanel}
          onClose={toggleRightPanel}
        />
      </aside>
    )
  }

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
