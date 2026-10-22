import { Check, Loader2, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { ModelEntry, ModelProtocol, ModelSettings } from '@pictor/shared'

import type { ModelProbeResult } from '../../../../shared/bridge.js'
import { Badge, Banner, Button, Input, Select } from '../../components/ui/index.js'
import { Section } from './Section.js'
import { SettingActions, SettingRow } from './SettingRow.js'

interface FormState {
  providerName: string
  baseUrl: string
  protocol: ModelProtocol
  modelId: string
  models: ModelEntry[]
  apiKey: string
}

const EMPTY: FormState = {
  providerName: '',
  baseUrl: '',
  protocol: 'chat-completions',
  modelId: '',
  models: [],
  apiKey: '',
}

function toForm(settings: ModelSettings): FormState {
  return {
    providerName: settings.providerName,
    baseUrl: settings.baseUrl,
    protocol: settings.protocol,
    modelId: settings.modelId,
    models: settings.models,
    apiKey: '',
  }
}

/** True when the draft differs from what is stored, including a new API Key. */
function isDirty(form: FormState, saved: ModelSettings | null): boolean {
  if (saved === null) return false
  if (form.apiKey.trim().length > 0) return true

  return (
    form.providerName.trim() !== saved.providerName ||
    form.baseUrl.trim().replace(/\/+$/, '') !== saved.baseUrl ||
    form.protocol !== saved.protocol ||
    form.modelId.trim() !== saved.modelId ||
    JSON.stringify(form.models) !== JSON.stringify(saved.models)
  )
}

export function ModelSection(): React.JSX.Element {
  const [form, setForm] = useState<FormState>(EMPTY)
  const [saved, setSaved] = useState<ModelSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [probe, setProbe] = useState<ModelProbeResult | null>(null)

  useEffect(() => {
    void (async () => {
      const settings = await window.pictor.getModelSettings()
      setSaved(settings)
      setForm(toForm(settings))
    })().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }, [])

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await action()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  function patch(changes: Partial<FormState>): void {
    setForm((current) => ({ ...current, ...changes }))
  }

  const dirty = isDirty(form, saved)

  return (
    <Section
      title="连接"
      description="Pictor 通过 OpenAI 兼容端点调用模型；API Key 只保存在本机的 auth.json。"
      actions={
        <Badge tone={saved?.hasApiKey === true ? 'success' : 'neutral'}>
          {saved?.hasApiKey === true ? '密钥已保存' : '未设置密钥'}
        </Badge>
      }
      padded={false}
      footer={
        <SettingActions
          dirty={dirty}
          busy={busy}
          onDiscard={() => {
            setForm(saved === null ? EMPTY : toForm(saved))
            setError(null)
            setNotice(null)
          }}
          onSave={() =>
            void run(async () => {
              const next = await window.pictor.saveModelSettings({
                providerName: form.providerName,
                baseUrl: form.baseUrl,
                protocol: form.protocol,
                modelId: form.modelId,
                models: form.models,
                ...(form.apiKey.trim().length > 0 ? { apiKey: form.apiKey } : {}),
              })
              setSaved(next)
              setForm(toForm(next))
              setNotice('模型配置已保存')
            })
          }
        />
      }
    >
      {error !== null && (
        <div className="px-4 py-3">
          <Banner tone="error">{error}</Banner>
        </div>
      )}
      {notice !== null && (
        <div className="px-4 py-3">
          <Banner tone="notice">{notice}</Banner>
        </div>
      )}

      <SettingRow
        id="pi.providerName"
        title="服务名称"
        description="只用于辨认这条配置。"
        control={
          <Input
            className="w-56"
            value={form.providerName}
            placeholder="Neko / DeepSeek / 自建"
            aria-label="服务名称"
            onChange={(event) => patch({ providerName: event.target.value })}
          />
        }
      />

      <SettingRow
        id="pi.protocol"
        title="API 风格"
        description="取决于端点实现的是 Chat Completions 还是 Responses。"
        control={
          <Select
            className="w-56"
            value={form.protocol}
            aria-label="API 风格"
            onChange={(event) => patch({ protocol: event.target.value as ModelProtocol })}
          >
            <option value="chat-completions">Chat Completions</option>
            <option value="responses">Responses</option>
          </Select>
        }
      />

      <SettingRow
        id="pi.baseUrl"
        stacked
        title="Base URL"
        description="不含末尾的 /v1 也可以，保存时会去掉多余的斜杠。"
        control={
          <Input
            value={form.baseUrl}
            placeholder="https://api.example.com/v1"
            className="font-mono"
            aria-label="Base URL"
            onChange={(event) => patch({ baseUrl: event.target.value })}
          />
        }
      />

      <SettingRow
        id="pi.models"
        title="已获取的模型"
        description="从端点拉取的列表，选择后会填入模型 ID。"
        control={
          <Select
            className="w-56"
            value={form.models.some((model) => model.id === form.modelId) ? form.modelId : ''}
            aria-label="已获取的模型"
            onChange={(event) => patch({ modelId: event.target.value })}
          >
            <option value="">手动输入 / 未选择</option>
            {form.models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name ?? model.id}
              </option>
            ))}
          </Select>
        }
      />

      <SettingRow
        id="pi.modelId"
        title="模型 ID"
        description="发送给端点的 model 字段。"
        control={
          <Input
            className="w-56 font-mono"
            value={form.modelId}
            placeholder="deepseek-v4.1-flash"
            aria-label="模型 ID"
            onChange={(event) => patch({ modelId: event.target.value })}
          />
        }
      />

      <SettingRow
        id="pi.apiKey"
        stacked
        title="API Key"
        description={
          saved?.hasApiKey === true ? '已保存；留空表示不修改。' : '只写入本机 auth.json。'
        }
        control={
          <Input
            type="password"
            value={form.apiKey}
            placeholder={saved?.hasApiKey === true ? '••••••••' : '粘贴 API Key'}
            aria-label="API Key"
            onChange={(event) => patch({ apiKey: event.target.value })}
          />
        }
      />

      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || form.baseUrl.trim().length === 0}
          onClick={() =>
            void run(async () => {
              const models = await window.pictor.fetchModels({
                baseUrl: form.baseUrl,
                protocol: form.protocol,
                ...(form.apiKey.trim().length > 0 ? { apiKey: form.apiKey } : {}),
              })
              patch({
                models,
                modelId: form.modelId.length > 0 ? form.modelId : (models[0]?.id ?? ''),
              })
              setNotice(`获取到 ${String(models.length)} 个模型（保存后生效）`)
            })
          }
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          获取模型
        </Button>

        <Button
          variant="secondary"
          size="sm"
          disabled={busy || saved === null || dirty}
          onClick={() =>
            void run(async () => {
              setProbe(await window.pictor.testModelConnection())
            })
          }
        >
          <Check className="size-3.5" />
          测试连接
        </Button>

        {dirty && <span className="text-2xs text-faint">先保存再测试</span>}
      </div>

      {probe !== null && (
        <div className="px-4 pb-3">
          <div
            className={
              probe.ok
                ? 'rounded-md border border-success/30 bg-success/5 px-3 py-2'
                : 'rounded-md border border-danger/30 bg-danger/5 px-3 py-2'
            }
          >
            <p className={probe.ok ? 'text-xs text-success' : 'text-xs text-danger'}>
              {probe.ok ? '连接成功' : '连接失败'} · {probe.message}
            </p>
            {probe.sample.length > 0 && (
              <p className="mt-1 font-mono text-2xs text-muted">{probe.sample}</p>
            )}
          </div>
        </div>
      )}
    </Section>
  )
}
