import { Check, Loader2, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { ModelEntry, ModelProtocol, ModelSettings } from '@pictor/shared'

import type { ModelProbeResult } from '../../../../shared/bridge.js'
import { Badge, Banner, Button, Field, Input, Select } from '../../components/ui/index.js'
import { Section } from './Section.js'

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

  return (
    <Section
      title="模型服务"
      description="Pictor 通过 OpenAI 兼容端点调用模型；API Key 只保存在本机的 auth.json。"
      actions={
        <Badge tone={saved?.hasApiKey === true ? 'success' : 'neutral'}>
          {saved?.hasApiKey === true ? '密钥已保存' : '未设置密钥'}
        </Badge>
      }
    >
      {error !== null && <Banner tone="error">{error}</Banner>}
      {notice !== null && <Banner tone="notice">{notice}</Banner>}

      <div className="grid grid-cols-2 gap-3">
        <Field label="服务名称">
          <Input
            value={form.providerName}
            placeholder="Neko / DeepSeek / 自建"
            onChange={(event) => patch({ providerName: event.target.value })}
          />
        </Field>

        <Field label="API 风格">
          <Select
            value={form.protocol}
            onChange={(event) => patch({ protocol: event.target.value as ModelProtocol })}
          >
            <option value="chat-completions">Chat Completions</option>
            <option value="responses">Responses</option>
          </Select>
        </Field>

        <Field label="Base URL" className="col-span-2">
          <Input
            value={form.baseUrl}
            placeholder="https://api.example.com/v1"
            className="font-mono"
            onChange={(event) => patch({ baseUrl: event.target.value })}
          />
        </Field>

        <Field label="已获取的模型">
          <Select
            value={form.models.some((model) => model.id === form.modelId) ? form.modelId : ''}
            onChange={(event) => patch({ modelId: event.target.value })}
          >
            <option value="">手动输入 / 未选择</option>
            {form.models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name ?? model.id}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="模型 ID">
          <Input
            value={form.modelId}
            placeholder="deepseek-v4.1-flash"
            className="font-mono"
            onChange={(event) => patch({ modelId: event.target.value })}
          />
        </Field>

        <Field
          label="API Key"
          className="col-span-2"
          hint={saved?.hasApiKey === true ? '已保存；留空表示不修改' : '只写入本机 auth.json'}
        >
          <Input
            type="password"
            value={form.apiKey}
            placeholder={saved?.hasApiKey === true ? '••••••••' : '粘贴 API Key'}
            onChange={(event) => patch({ apiKey: event.target.value })}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          disabled={busy}
          onClick={() =>
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
        >
          保存
        </Button>

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
          disabled={busy || saved === null}
          onClick={() =>
            void run(async () => {
              setProbe(await window.pictor.testModelConnection())
            })
          }
        >
          <Check className="size-3.5" />
          测试连接
        </Button>
      </div>

      {probe !== null && (
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
      )}
    </Section>
  )
}
