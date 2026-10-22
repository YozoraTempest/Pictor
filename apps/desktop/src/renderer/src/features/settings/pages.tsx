import { Blocks, Cpu, Info, Settings2, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { AboutSection } from './AboutSection.js'
import { AgentModelActions, AgentModelPage } from './AgentModelPage.js'
import { GeneralSection } from './GeneralSection.js'
import { PluginsSection } from './PluginsSection.js'

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

const PAGES = [
  {
    id: 'general',
    label: '常规',
    icon: Settings2,
    description: '会话列表与置顶行为',
    keywords: '常规 通用 互斥 置顶',
    group: '偏好',
    order: 0,
    render: () => <GeneralSection />,
  },
  {
    id: 'model',
    label: '模型',
    icon: Cpu,
    description: 'AI 服务、模型目录与试运行',
    keywords: '模型 api key base url 端点 导入 cc-switch 试运行 agent 服务',
    group: '智能体',
    order: 0,
    render: () => <AgentModelPage />,
    actions: () => <AgentModelActions />,
  },
  {
    id: 'plugins',
    label: '拓展',
    icon: Blocks,
    description: '插件与面板的启用状态',
    keywords: '插件 plugin 拓展 面板',
    group: '扩展',
    order: 0,
    render: () => <PluginsSection />,
  },
  {
    id: 'about',
    label: '关于 Pictor',
    icon: Info,
    description: '版本、运行时与数据库位置',
    keywords: '关于 版本 version',
    group: '系统',
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
 * data (plugins, imported providers) are not listed: they have no stable id.
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
  {
    id: 'pi.providerName',
    page: 'model',
    title: '服务名称',
    description: '只用于辨认这条配置',
    keywords: '名称 provider 服务',
  },
  {
    id: 'pi.protocol',
    page: 'model',
    title: 'API 风格',
    description: 'Chat Completions 或 Responses',
    keywords: '协议 protocol 风格 responses',
  },
  {
    id: 'pi.baseUrl',
    page: 'model',
    title: 'Base URL',
    description: '端点的根地址',
    keywords: '地址 端点 url base',
  },
  {
    id: 'pi.models',
    page: 'model',
    title: '已获取的模型',
    description: '从端点拉取的模型列表',
    keywords: '模型 列表 获取 models',
  },
  {
    id: 'pi.modelId',
    page: 'model',
    title: '模型 ID',
    description: '发送给端点的 model 字段',
    keywords: '模型 model id',
  },
  {
    id: 'pi.apiKey',
    page: 'model',
    title: 'API Key',
    description: '只写入本机 auth.json',
    keywords: '密钥 key 凭证 token',
  },
  {
    id: 'agent.prompt',
    page: 'model',
    title: '提示词',
    description: '试运行时发给模型的内容',
    keywords: '提示词 prompt 试运行 测试',
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
