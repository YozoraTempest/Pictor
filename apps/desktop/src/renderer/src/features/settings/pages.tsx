import {
  Blocks,
  BookOpen,
  Cpu,
  Info,
  Settings2,
  Shield,
  ShieldCheck,
  Terminal,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'

import { AboutSection } from './AboutSection.js'
import { AgentModelPage } from './AgentModelPage.js'
import { DefaultPermissionSection } from './DefaultPermissionSection.js'
import { GeneralSection } from './GeneralSection.js'
import { PluginsSection } from './PluginsSection.js'
import { RuntimePage } from './RuntimePage.js'
import { SkillsSection } from './SkillsSection.js'
import { ToolRulesSection } from './ToolRulesSection.js'

/** One page in the settings sidebar. */
export interface SettingsPage {
  id: string
  label: string
  icon: LucideIcon
  description: string
  keywords: string
  /** Sidebar group heading. */
  group: string
  order: number
  render: () => ReactNode
  /** Shown beside the page title, for page-level actions. */
  actions?: () => ReactNode
}

/**
 * The three groups the sidebar shows.
 *
 * The split is by owner, not by topic: what belongs to the shell, what belongs to
 * dsh, and what belongs to Pi. A setting that only means something inside one
 * kernel lives in that kernel's group, so a reader looking for "the sandbox
 * default" does not have to guess whether it applies to the kernel they run.
 */
const GROUPS = {
  general: '通用',
  dsh: 'DSH',
  pi: 'Pi',
} as const

const PAGES = [
  {
    id: 'general',
    label: '常规',
    icon: Settings2,
    description: '会话列表在左栏里怎么分组',
    keywords: '常规 通用 互斥 置顶 重复 分区 时间线 最近',
    group: GROUPS.general,
    order: 0,
    render: () => <GeneralSection />,
  },
  {
    id: 'rules',
    label: '工具规则',
    icon: ShieldCheck,
    description: '按工具拒绝、询问或自动同意 agent 的调用',
    keywords: '工具 规则 权限 拒绝 询问 允许 bash 拦截 rule 内核',
    group: GROUPS.general,
    order: 1,
    render: () => <ToolRulesSection />,
  },
  {
    id: 'plugins',
    label: '拓展',
    icon: Blocks,
    description: '插件与面板的启用状态',
    keywords: '插件 plugin 拓展 面板',
    group: GROUPS.general,
    order: 2,
    render: () => <PluginsSection />,
  },
  {
    id: 'about',
    label: '关于 Pictor',
    icon: Info,
    description: '版本、数据目录与许可',
    keywords: '关于 版本 version 路径 数据库',
    group: GROUPS.general,
    order: 3,
    render: () => <AboutSection />,
  },
  {
    id: 'model',
    label: '模型',
    icon: Cpu,
    description: 'DSH 使用的 AI 服务：地址、密钥、模型与试运行',
    keywords: '模型 api key base url 端点 连接 导入 cc-switch 试运行 agent 服务 provider dsh',
    group: GROUPS.dsh,
    order: 0,
    render: () => <AgentModelPage />,
  },
  {
    id: 'permission',
    label: '默认权限',
    icon: Shield,
    description: '新建的 DSH 会话用哪个沙箱范围',
    keywords: '默认 权限 沙箱 只读 工作区 完全访问 permission dsh 审批',
    group: GROUPS.dsh,
    order: 1,
    render: () => <DefaultPermissionSection />,
  },
  {
    id: 'skills',
    label: '技能',
    icon: BookOpen,
    description: 'DSH 能加载的技能，以及它们来自哪个文件',
    keywords: '技能 skill 技能目录 SKILL.md 提示 说明 dsh 启用 停用',
    group: GROUPS.dsh,
    order: 2,
    render: () => <SkillsSection />,
  },
  {
    id: 'dsh-runtime',
    label: '运行时',
    icon: Terminal,
    description: 'DSH 的进程：状态、版本与启停',
    keywords: '运行时 runtime 进程 启动 停止 版本 安装 会话数据 dsh harness 重装',
    group: GROUPS.dsh,
    order: 3,
    render: () => <RuntimePage kernel="dsh" />,
  },
  {
    id: 'pi-runtime',
    label: '运行时',
    icon: Terminal,
    description: 'Pi 的安装状态、版本与可执行文件',
    keywords: '运行时 runtime pi 安装 版本 可执行文件 PICTOR_PI_BIN 会话数据 重新检测',
    group: GROUPS.pi,
    order: 0,
    render: () => <RuntimePage kernel="pi" />,
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

/** Pages in sidebar order, grouped. */
export function settingsGroups(): Array<{
  title: string
  pages: Array<SettingsPage & { id: SettingsPageId }>
}> {
  const titles: string[] = []
  for (const page of SETTINGS_PAGES) {
    if (!titles.includes(page.group)) titles.push(page.group)
  }

  return titles.map((title) => ({
    title,
    pages: SETTINGS_PAGES.filter((page) => page.group === title).sort((a, b) => a.order - b.order),
  }))
}
