import { useState } from 'react'

import { cn } from '../../lib/cn.js'
import { ExtensionsView } from '../extensions/ExtensionsView.js'
import { RuntimePage } from './RuntimePage.js'
import { SettingsView } from './SettingsView.js'

/** The three things this page answers, in the order a person meets them. */
const TABS = [
  { id: 'runtime', label: '运行时', hint: '它在跑吗，什么版本，开关在哪' },
  { id: 'extensions', label: '拓展', hint: '插件、技能、MCP' },
  { id: 'preferences', label: '偏好', hint: '模型服务、权限默认值、通用' },
] as const

type TabId = (typeof TABS)[number]['id']

/**
 * One ars's settings.
 *
 * Everything that belongs to the engine lives here rather than under the window's own
 * preferences: its process and version, the things it can be extended with, and the
 * preferences that only mean anything while dsh is the thing running conversations. It is
 * one page with three tabs because they answer different questions and a person arrives
 * knowing which one — 拓展 is not a setting, but it is the same engine's business.
 */
export function ArsSettingsPage({
  kernel,
  label,
}: {
  kernel: string
  label: string
}): React.JSX.Element {
  const [tab, setTab] = useState<TabId>('runtime')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="tablist"
        aria-label={`${label} 设置`}
        className="flex shrink-0 items-center gap-1 border-b border-border px-3"
      >
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            onClick={() => setTab(entry.id)}
            className={cn(
              '-mb-px border-b-2 px-2.5 py-2 text-xs transition-colors duration-150',
              tab === entry.id
                ? 'border-accent text-text'
                : 'border-transparent text-muted hover:text-text',
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        {tab === 'runtime' && <RuntimePage kernel={kernel} />}
        {tab === 'extensions' && <ExtensionsView />}
        {tab === 'preferences' && <SettingsView />}
      </div>
    </div>
  )
}
