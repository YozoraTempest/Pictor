import {
  Blocks,
  Cpu,
  Download,
  FlaskConical,
  Info,
  Search,
  Settings2,
  type LucideIcon,
} from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'

import { Input } from '../../components/ui/index.js'
import { cn } from '../../lib/cn.js'
import { AboutSection } from './AboutSection.js'
import { AgentTestSection } from './AgentTestSection.js'
import { CcSwitchSection } from './CcSwitchSection.js'
import { GeneralSection } from './GeneralSection.js'
import { ModelSection } from './ModelSection.js'
import { PluginsSection } from './PluginsSection.js'

interface SettingsItem {
  id: string
  label: string
  icon: LucideIcon
  description: string
  keywords: string
  /** Rendered when the item is selected; the list above is the only index. */
  render: () => ReactNode
}

const GROUPS: Array<{ title: string; items: SettingsItem[] }> = [
  {
    title: '个人',
    items: [
      {
        id: 'general',
        render: () => <GeneralSection />,
        label: '常规',
        icon: Settings2,
        description: '会话列表与置顶行为',
        keywords: '常规 通用 互斥 置顶',
      },
      {
        id: 'model',
        render: () => <ModelSection />,
        label: '模型服务',
        icon: Cpu,
        description: 'OpenAI 兼容端点与 API Key',
        keywords: '模型 api key base url 端点',
      },
    ],
  },
  {
    title: '集成',
    items: [
      {
        id: 'plugins',
        render: () => <PluginsSection />,
        label: '拓展',
        icon: Blocks,
        description: '插件与面板的启用状态',
        keywords: '插件 plugin',
      },
      {
        id: 'import',
        render: () => <CcSwitchSection />,
        label: '导入配置',
        icon: Download,
        description: '从 cc-switch 只读导入 provider',
        keywords: '导入 cc-switch 配置',
      },
    ],
  },
  {
    title: '编码',
    items: [
      {
        id: 'agent',
        render: () => <AgentTestSection />,
        label: 'Agent 试运行',
        icon: FlaskConical,
        description: '端到端验证当前模型配置',
        keywords: 'agent 试运行 测试',
      },
    ],
  },
  {
    title: '关于',
    items: [
      {
        id: 'about',
        render: () => <AboutSection />,
        label: '关于 Pictor',
        icon: Info,
        description: '版本、运行时与数据库位置',
        keywords: '关于 版本 version',
      },
    ],
  },
]

const ITEMS = GROUPS.flatMap((group) => group.items)

export function SettingsView(): React.JSX.Element {
  const [active, setActive] = useState<string>('general')
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle.length === 0) return GROUPS

    return GROUPS.map((group) => ({
      title: group.title,
      items: group.items.filter(
        (item) =>
          item.label.toLowerCase().includes(needle) ||
          item.description.toLowerCase().includes(needle) ||
          item.keywords.toLowerCase().includes(needle),
      ),
    })).filter((group) => group.items.length > 0)
  }, [query])

  const current = ITEMS.find((item) => item.id === active) ?? ITEMS[0]

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface/20">
        <div className="px-3 pt-3 pb-2">
          <h1 className="mb-2 text-sm font-semibold">设置</h1>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-faint" />
            <Input
              value={query}
              aria-label="搜索设置"
              placeholder="搜索"
              className="h-8 pl-7 text-xs"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>

        <nav aria-label="设置分类" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {filtered.length === 0 ? (
            <p className="px-2 py-3 text-2xs text-faint">没有匹配的设置项。</p>
          ) : (
            filtered.map((group) => (
              <div key={group.title} className="mb-2">
                <h2 className="px-2 pt-1 pb-1 text-2xs font-semibold tracking-wider text-faint uppercase">
                  {group.title}
                </h2>
                <ul className="flex flex-col gap-px">
                  {group.items.map((item) => {
                    const Icon = item.icon
                    const isActive = item.id === active
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          aria-current={isActive ? 'page' : undefined}
                          onClick={() => setActive(item.id)}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors duration-150',
                            isActive
                              ? 'bg-surface-raised text-text'
                              : 'text-muted hover:bg-surface-hover hover:text-text',
                          )}
                        >
                          <Icon
                            className={cn(
                              'size-3.5 shrink-0',
                              isActive ? 'text-accent' : 'text-faint',
                            )}
                          />
                          <span className="truncate">{item.label}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))
          )}
        </nav>
      </aside>

      <section className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-8 py-7">
          <header>
            <h2 className="text-lg font-semibold">{current?.label ?? '设置'}</h2>
            <p className="mt-0.5 text-xs text-faint">{current?.description ?? ''}</p>
          </header>

          {current?.render()}
        </div>
      </section>
    </div>
  )
}
