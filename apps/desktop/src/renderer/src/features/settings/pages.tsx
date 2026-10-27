import { Cpu, Info, Settings2, ShieldCheck, Terminal, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { AboutSection } from './AboutSection.js'
import { AgentModelPage } from './AgentModelPage.js'
import { DefaultPermissionSection } from './DefaultPermissionSection.js'
import { GeneralSection } from './GeneralSection.js'
import { RuntimePage } from './RuntimePage.js'
import { ToolRulesSection } from './ToolRulesSection.js'

/** One page in the settings sidebar. */
export interface SettingsPage {
  id: string
  label: string
  icon: LucideIcon
  description: string
  keywords: string
  /** Top level of the sidebar: whose setting this is. */
  category: string
  /**
   * Middle level, for a category with enough pages to need one.
   *
   * Optional on purpose: a category of three pages reads worse split into three
   * headings of one, so the tree only grows a level where it carries meaning.
   */
  group?: string
  order: number
  render: () => ReactNode
  /** Shown beside the page title, for page-level actions. */
  actions?: () => ReactNode
}

/** One collapsible middle level: the pages filed under one group name. */
export interface SettingsGroupNode {
  title: string
  pages: Array<SettingsPage & { id: SettingsPageId }>
}

/**
 * One top level of the sidebar.
 *
 * `entries` keeps the author's order across pages and groups, so a category can be
 * "a page, then a group, then another page" without the group floating to the top.
 */
export interface SettingsCategory {
  title: string
  entries: Array<
    | { kind: 'page'; page: SettingsPage & { id: SettingsPageId } }
    | { kind: 'group'; group: SettingsGroupNode }
  >
}

/**
 * The sidebar's top level: whose setting this is.
 *
 * 通用 is what the app decides, whatever kernel runs the conversation: the shell,
 * the model services, the tool policy, the skills a session can load, the kernels
 * themselves. DSH and Pi keep only their own runtime — a process, a version, an
 * install — because that is the one thing that truly belongs to one kernel. 关于 is
 * the page nobody looks for until they need it.
 */
const CATEGORIES = {
  general: '通用',
  dsh: 'DSH',
  pi: 'Pi',
  about: '关于',
} as const

const PAGES = [
  {
    id: 'general',
    label: '常规',
    icon: Settings2,
    description: '会话列表在左栏里怎么分组',
    keywords: '常规 通用 偏好 互斥 置顶 重复 分区 时间线 最近',
    category: CATEGORIES.general,
    group: '偏好',
    order: 0,
    render: () => <GeneralSection />,
  },
  {
    id: 'model',
    label: '模型',
    icon: Cpu,
    description: 'AI 服务：地址、密钥、模型与试运行。DSH 用这些服务跑会话。',
    keywords: '模型 api key base url 端点 连接 导入 cc-switch 试运行 agent 服务 provider',
    category: CATEGORIES.general,
    order: 2,
    render: () => <AgentModelPage />,
  },
  {
    id: 'permission',
    label: '权限',
    icon: ShieldCheck,
    description: '什么范围内不用问，问的时候怎么答',
    keywords: '权限 规则 工具 沙箱 拒绝 询问 允许 只读 工作区 完全访问 bash 拦截 rule 内核',
    category: CATEGORIES.general,
    group: '偏好',
    order: 1,
    render: () => (
      <>
        <ToolRulesSection />
        <DefaultPermissionSection />
      </>
    ),
  },
  {
    id: 'dsh-runtime',
    label: '运行时',
    icon: Terminal,
    description: 'DSH 的进程：状态、版本与启停',
    keywords: '运行时 runtime 进程 启动 停止 版本 安装 会话数据 dsh harness 重装',
    category: CATEGORIES.dsh,
    order: 0,
    render: () => <RuntimePage kernel="dsh" />,
  },
  {
    id: 'pi-runtime',
    label: '运行时',
    icon: Terminal,
    description: 'Pi 的安装状态、版本与可执行文件',
    keywords: '运行时 runtime pi 安装 版本 可执行文件 PICTOR_PI_BIN 会话数据 重新检测',
    category: CATEGORIES.pi,
    order: 0,
    render: () => <RuntimePage kernel="pi" />,
  },
  {
    id: 'about',
    label: '关于 Pictor',
    icon: Info,
    description: '版本、数据目录与许可',
    keywords: '关于 版本 version 路径 数据库 许可',
    category: CATEGORIES.about,
    order: 0,
    render: () => <AboutSection />,
  },
] as const satisfies readonly SettingsPage[]

export type SettingsPageId = (typeof PAGES)[number]['id']

export const SETTINGS_PAGES: ReadonlyArray<SettingsPage & { id: SettingsPageId }> = PAGES

/**
 * Every setting row, indexed for search.
 *
 * Pages own how a row looks; this list owns what it is called, so search can
 * point at one row instead of the page it happens to live on. Rows rendered from
 * data (plugins, imported providers) are not listed: they have no stable id, and
 * neither are rows that live inside a dialog — search cannot scroll to something
 * that is not on the page. Those settings are reachable through the page keywords.
 */
export interface SettingRowEntry {
  /** Matches the `id` the page gives its `SettingRow`, and its `data-setting-row`. */
  id: string
  page: SettingsPageId
  title: string
  description: string
  keywords: string
}

export const SETTING_ROWS: readonly SettingRowEntry[] = [
  {
    id: 'sessions.grouping',
    page: 'general',
    title: '会话出现在哪些分区',
    description: '允许重复 / 置顶互斥 / 基本互斥 / 全部互斥',
    keywords: '分组 互斥 置顶 重复 时间线 最近',
  },
]

/**
 * The sidebar as a tree: categories, with pages and (where they earn it) a group.
 *
 * Consecutive pages that share a `group` become one collapsible block, so a category
 * can be "a page, then a group, then another page" in the order it was written.
 */
export function settingsTree(): SettingsCategory[] {
  const titles: string[] = []
  for (const page of SETTINGS_PAGES) {
    if (!titles.includes(page.category)) titles.push(page.category)
  }

  return titles.map((title) => {
    const pages = SETTINGS_PAGES.filter((page) => page.category === title).sort(
      (a, b) => a.order - b.order,
    )

    const entries: SettingsCategory['entries'] = []
    for (const page of pages) {
      const group = page.group
      if (group === undefined) {
        entries.push({ kind: 'page', page })
        continue
      }
      // Same group directly above? Then it is the block being built.
      const last = entries[entries.length - 1]
      if (last !== undefined && last.kind === 'group' && last.group.title === group) {
        last.group.pages.push(page)
        continue
      }
      entries.push({ kind: 'group', group: { title: group, pages: [page] } })
    }

    return { title, entries }
  })
}
