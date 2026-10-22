import { Download, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { ModelSettings } from '@pictor/shared'

import { Badge, Button, Dialog, Tooltip } from '../../components/ui/index.js'
import { AgentTestSection } from './AgentTestSection.js'
import { CcSwitchSection } from './CcSwitchSection.js'
import { ModelSection } from './ModelSection.js'
import { Section } from './Section.js'
import { SettingRow } from './SettingRow.js'

/** Host part of the endpoint, for the service row's secondary line. */
function hostOf(baseUrl: string): string {
  if (baseUrl.length === 0) return '未配置端点'
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl
  }
}

/**
 * Page-level actions, shown beside the 模型 heading.
 *
 * The import dialog lives here rather than in the page body: the header renders
 * beside the page, not inside it, so a shared context would never reach it.
 */
export function AgentModelActions(): React.JSX.Element {
  const [importing, setImporting] = useState(false)

  return (
    <>
      <Tooltip label="从 cc-switch 读取 provider 配置" side="bottom" align="end">
        <Button variant="secondary" size="sm" onClick={() => setImporting(true)}>
          <Download className="size-3.5" />
          从其他工具导入
        </Button>
      </Tooltip>
      <Tooltip label="目前只支持一个服务" side="bottom" align="end">
        <Button variant="primary" size="sm" disabled>
          <Plus className="size-3.5" />
          添加服务
        </Button>
      </Tooltip>

      <Dialog open={importing} title="从其他工具导入" onClose={() => setImporting(false)}>
        <CcSwitchSection />
      </Dialog>
    </>
  )
}

/**
 * Everything about talking to a model, on one page: the service row, the
 * connection form behind it, the model directory and a one-shot runtime test.
 *
 * The list has a single row because the host stores one provider; the row is
 * built the way a multi-provider list would be, so adding more later is a
 * host-side change plus another entry here.
 */
export function AgentModelPage(): React.JSX.Element {
  const [settings, setSettings] = useState<ModelSettings | null>(null)

  useEffect(() => {
    void window.pictor
      .getModelSettings()
      .then(setSettings)
      .catch(() => setSettings(null))
  }, [])

  const modelCount = settings?.models.length ?? 0

  return (
    <>
      <Section title="AI 服务" description="会话使用选中的服务与模型对话。" padded={false}>
        {settings === null ? (
          <SettingRow title="读取配置…" control={null} />
        ) : (
          <SettingRow
            title={settings.providerName.length > 0 ? settings.providerName : '未命名服务'}
            description={`${hostOf(settings.baseUrl)} · ${String(modelCount)} 个模型`}
            control={
              <Badge tone={settings.hasApiKey ? 'success' : 'neutral'}>
                {settings.hasApiKey ? '使用中' : '未配置'}
              </Badge>
            }
          />
        )}
      </Section>

      <ModelSection />

      <Section
        title="模型目录"
        description="从端点拉取的模型清单，供「已获取的模型」选择。"
        padded={false}
      >
        <SettingRow
          title={`已获取 ${String(modelCount)} 个模型`}
          description={`来自 ${settings === null ? '—' : hostOf(settings.baseUrl)}`}
          control={<Badge tone="neutral">保存在本机配置</Badge>}
        />
      </Section>

      <AgentTestSection />
    </>
  )
}
