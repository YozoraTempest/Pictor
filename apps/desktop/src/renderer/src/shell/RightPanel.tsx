import { useState } from 'react'

import { useWorkspaceStore } from '../app/workspace-store.js'
import { CommandsPanel } from '../features/commands/CommandsPanel.js'
import { PluginsPanel } from '../features/plugins/PluginsPanel.js'
import { cn } from '../lib/cn.js'

type Tab = 'plugins' | 'commands' | 'about'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'plugins', label: '插件' },
  { id: 'commands', label: '命令' },
  { id: 'about', label: '关于' },
]

export function RightPanel(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('plugins')
  const info = useWorkspaceStore((state) => state.info)
  const report = useWorkspaceStore((state) => state.report)

  return (
    <aside className="min-h-0 overflow-hidden border-l border-border bg-surface/30">
      <div className="flex h-full w-full flex-col">
        <nav
          role="tablist"
          aria-label="侧栏"
          className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-2"
        >
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              onClick={() => setTab(entry.id)}
              className={cn(
                'inline-flex h-6 items-center rounded-sm px-2 text-2xs transition-colors duration-150',
                tab === entry.id ? 'bg-surface-raised text-text' : 'text-faint hover:text-muted',
              )}
            >
              {entry.label}
            </button>
          ))}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === 'plugins' && <PluginsPanel />}
          {tab === 'commands' && <CommandsPanel />}
          {tab === 'about' && (
            <dl className="flex flex-col gap-2 p-3 text-2xs">
              {[
                ['版本', info?.version],
                ['Electron', info?.electron],
                ['Node', info?.node],
                ['host-core', info?.hostCore],
                ['已激活插件', report === null ? null : String(report.activated.length)],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-2">
                  <dt className="text-faint">{label}</dt>
                  <dd className="truncate font-mono text-muted">{value ?? '—'}</dd>
                </div>
              ))}
              <div className="mt-1 flex flex-col gap-1">
                <dt className="text-faint">数据库</dt>
                <dd className="selectable break-all font-mono text-muted">
                  {info?.database ?? '—'}
                </dd>
              </div>
            </dl>
          )}
        </div>
      </div>
    </aside>
  )
}
