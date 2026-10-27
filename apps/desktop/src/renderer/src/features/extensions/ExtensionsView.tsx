import { Blocks, BookOpen, Server, type LucideIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { cn } from '../../lib/cn.js'
import { McpSection } from '../settings/McpSection.js'
import { KernelPluginsSection } from '../settings/KernelPluginsSection.js'
import { PluginsSection } from '../settings/PluginsSection.js'
import { SkillsSection } from '../settings/SkillsSection.js'

/**
 * What can be added to the app, in one place.
 *
 * These three used to be settings pages, which was the wrong shelf: a plugin, a skill or
 * an MCP server is not a preference — it is something you install, browse and switch on.
 * They also answered three different questions at different depths of the settings tree
 * (one under 通用, two under 通用 › 智能体), so nothing suggested they belonged together.
 *
 * One page, three tabs, no third navigation level: there are three things, and a sidebar
 * for three things costs more attention than it saves.
 */
type TabId = 'plugins' | 'skills' | 'mcp'

interface Tab {
  id: TabId
  label: string
  /** Rail tooltip and the tab's own description, kept one word. */
  hint: string
  icon: LucideIcon
  render: () => ReactNode
}

const TABS: readonly Tab[] = [
  {
    id: 'plugins',
    label: '插件',
    hint: '面板、守卫、技能与内核，一次装齐',
    icon: Blocks,
    // Two lists, one page: Pictor's own plugins, then the dsh plugins the kernel loads.
    // They are separate trees with separate reach, and the second section says so.
    render: () => (
      <>
        <PluginsSection />
        <KernelPluginsSection />
      </>
    ),
  },
  {
    id: 'skills',
    label: '技能',
    hint: '按需加载的说明文档',
    icon: BookOpen,
    render: () => <SkillsSection />,
  },
  {
    id: 'mcp',
    label: 'MCP',
    hint: '外部的工具服务器',
    icon: Server,
    render: () => <McpSection />,
  },
]

export function ExtensionsView(): React.JSX.Element {
  const [active, setActive] = useState<TabId>('plugins')
  const current = TABS.find((tab) => tab.id === active) ?? TABS[0]

  return (
    <section className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-8 py-7">
        <header className="flex items-baseline">
          <h1 className="text-lg font-semibold">拓展</h1>
        </header>

        {/* One level of navigation, drawn as tabs rather than a list: three entries do
            not need a column, and the row also says what each one is for. */}
        <div
          role="tablist"
          aria-label="拓展分类"
          className="flex flex-wrap items-stretch gap-1 border-b border-border"
        >
          {TABS.map((tab) => {
            const on = tab.id === current?.id
            const Icon = tab.icon

            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={on}
                title={tab.hint}
                onClick={() => setActive(tab.id)}
                className={cn(
                  'group -mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-xs transition-colors duration-150',
                  on ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text',
                )}
              >
                <Icon className={cn('size-3.5', on ? 'text-accent' : 'text-faint')} />
                {tab.label}
              </button>
            )
          })}
        </div>

        {current !== undefined && current.render()}
      </div>
    </section>
  )
}
