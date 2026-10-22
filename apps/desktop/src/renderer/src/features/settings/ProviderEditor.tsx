import { Check, Loader2, RefreshCw } from 'lucide-react'
import { useState } from 'react'

import type { ModelEntry, ModelProtocol, ProviderList, ProviderView } from '@pictor/shared'

import { Badge, Banner, Button, Input, Select } from '../../components/ui/index.js'
import { Section } from './Section.js'
import { SettingActions, SettingRow } from './SettingRow.js'

interface FormState {
  name: string
  baseUrl: string
  protocol: ModelProtocol
  modelId: string
  models: ModelEntry[]
  apiKey: string
}

function toForm(provider: ProviderView | null): FormState {
  return {
    name: provider?.name ?? '',
    baseUrl: provider?.baseUrl ?? '',
    protocol: provider?.protocol ?? 'chat-completions',
    modelId: provider?.modelId ?? '',
    models: provider?.models ?? [],
    apiKey: '',
  }
}

function isDirty(form: FormState, provider: ProviderView | null): boolean {
  if (provider === null) return form.baseUrl.trim().length > 0
  if (form.apiKey.trim().length > 0) return true

  return (
    form.name.trim() !== provider.name ||
    form.baseUrl.trim().replace(/\/+$/, '') !== provider.baseUrl ||
    form.protocol !== provider.protocol ||
    form.modelId.trim() !== provider.modelId ||
    JSON.stringify(form.models) !== JSON.stringify(provider.models)
  )
}

/**
 * Edits one provider.
 *
 * Saving writes the whole record at once, including the model list, so a fetch
 * and a rename cannot land in two different versions of the same provider.
 */
export function ProviderEditor({
  provider,
  active,
  onSaved,
  onDismiss,
}: {
  provider: ProviderView | null
  active: boolean
  onSaved: (list: ProviderList) => void
  onDismiss: () => void
}): React.JSX.Element {
  const [form, setForm] = useState<FormState>(() => toForm(provider))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const dirty = isDirty(form, provider)

  function patch(changes: Partial<FormState>): void {
    setForm((current) => ({ ...current, ...changes }))
  }

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

  return (
    <Section
      title={provider === null ? '添加服务' : '连接'}
      description={
        provider === null
          ? '填写端点后保存；保存后可在服务列表里切换使用。'
          : 'Pictor 通过 OpenAI 兼容端点调用模型；API Key 只保存在本机的 auth.json。'
      }
      actions={
        provider === null ? undefined : (
          <Badge tone={provider.hasApiKey ? 'success' : 'neutral'}>
            {provider.hasApiKey ? '密钥已保存' : '未设置密钥'}
          </Badge>
        )
      }
      padded={false}
      footer={
        <SettingActions
          dirty={dirty}
          busy={busy}
          saveLabel={provider === null ? '添加' : '保存'}
          onDiscard={() => {
            setForm(toForm(provider))
            setError(null)
            setNotice(null)
            if (provider === null) onDismiss()
          }}
          onSave={() =>
            void run(async () => {
              const list = await window.pictor.saveProvider({
                ...(provider === null ? {} : { id: provider.id }),
                name: form.name,
                baseUrl: form.baseUrl,
                protocol: form.protocol,
                modelId: form.modelId,
                models: form.models,
                ...(form.apiKey.trim().length > 0 ? { apiKey: form.apiKey } : {}),
              })
              onSaved(list)
              setForm((current) => ({ ...current, apiKey: '' }))
              setNotice('已保存')
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
        title="服务名称"
        description="只用于辨认这条配置。"
        control={
          <Input
            className="w-56"
            value={form.name}
            placeholder="Neko / DeepSeek / 自建"
            aria-label="服务名称"
            onChange={(event) => patch({ name: event.target.value })}
          />
        }
      />

      <SettingRow
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
        stacked
        title="Base URL"
        description="末尾的斜杠会去掉。"
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
        title="模型"
        description={`已获取 ${String(form.models.length)} 个；选择后会填入模型 ID。`}
        control={
          <Select
            className="w-56"
            value={form.models.some((model) => model.id === form.modelId) ? form.modelId : ''}
            aria-label="模型"
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
        stacked
        title="API Key"
        description={
          provider?.hasApiKey === true ? '已保存；留空表示不修改。' : '只写入本机 auth.json。'
        }
        control={
          <Input
            type="password"
            value={form.apiKey}
            placeholder={provider?.hasApiKey === true ? '••••••••' : '粘贴 API Key'}
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
          disabled={busy || !active || dirty}
          onClick={() =>
            void run(async () => {
              const result = await window.pictor.testModelConnection()
              setNotice(result.ok ? '连接成功' : `连接失败 · ${result.message}`)
            })
          }
        >
          <Check className="size-3.5" />
          测试连接
        </Button>

        {!active && <span className="text-2xs text-faint">设为使用中后可测试</span>}
        {active && dirty && <span className="text-2xs text-faint">先保存再测试</span>}
      </div>
    </Section>
  )
}
