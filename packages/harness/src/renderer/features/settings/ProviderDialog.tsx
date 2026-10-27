import { Check, Loader2, RefreshCw } from 'lucide-react'
import { useState } from 'react'

import type {
  ModelEffort,
  ModelEntry,
  ModelProtocol,
  ProviderList,
  ProviderView,
} from '@vulonlok/shared'
import { MODEL_EFFORTS, OMIT_EFFORT } from '@vulonlok/shared'

import { Badge, Banner, Button, Dialog, Input, Select, Switch } from '@vulonlok/ui'
import { cn } from '@vulonlok/ui/cn'
import { effortLabel } from '../chat/effort.js'
import { capabilitiesOf, mergeModels, withCapabilities } from './models.js'
import { SettingRow } from './SettingRow.js'

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
    protocol: provider?.protocol ?? 'openai-completions',
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
 * Edits one service, in a dialog.
 *
 * The form is a modal rather than part of the page because a service is a record,
 * not a page: opening one to change a model keeps the list — the thing the page is
 * actually about — in view behind it. Adding reuses the same dialog with nothing
 * loaded, so there is one form to learn.
 */
export function ProviderDialog({
  open,
  provider,
  active,
  onSaved,
  onClose,
}: {
  open: boolean
  provider: ProviderView | null
  /** Only the active service can be probed: the runtime resolves one endpoint. */
  active: boolean
  onSaved: (list: ProviderList) => void
  onClose: () => void
}): React.JSX.Element {
  const [form, setForm] = useState<FormState>(() => toForm(provider))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const dirty = isDirty(form, provider)
  const capabilities = capabilitiesOf(form.models.find((model) => model.id === form.modelId))
  const hasModel = form.modelId.trim().length > 0

  /** One capability at a time; the entry is created for a model that was typed. */
  function setCapability(changes: Parameters<typeof withCapabilities>[2]): void {
    if (!hasModel) return
    patch({ models: withCapabilities(form.models, form.modelId, changes) })
  }

  /**
   * Toggle one level on or off.
   *
   * The last remaining level is not removable: a model that declares reasoning but
   * offers no level would show a picker with nothing in it, and the runtime refuses
   * that declaration outright.
   */
  function toggleEffort(level: ModelEffort): void {
    const current = capabilities.efforts
    const next = current.includes(level)
      ? current.filter((entry) => entry !== level)
      : [...current, level]
    if (next.length === 0) return
    setCapability({ efforts: MODEL_EFFORTS.filter((entry) => next.includes(entry)) })
  }

  function limitOf(value: string): number | null {
    const parsed = Number(value.trim())
    return value.trim().length === 0 || !Number.isFinite(parsed) ? null : parsed
  }

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

  function discard(): void {
    setForm(toForm(provider))
    setError(null)
    setNotice(null)
  }

  return (
    <Dialog
      open={open}
      title={provider === null ? '添加服务' : `编辑「${provider.name || '未命名服务'}」`}
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto text-2xs text-faint">
            {dirty ? '有未保存的修改' : provider === null ? '填写端点后即可添加' : '已保存'}
          </span>
          <Button variant="ghost" size="sm" disabled={!dirty || busy} onClick={discard}>
            撤销
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!dirty || busy}
            onClick={() =>
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
                onClose()
              })
            }
          >
            {provider === null ? '添加' : '保存'}
          </Button>
        </>
      }
    >
      <div className="-mx-5 -my-4 flex flex-col divide-y divide-border">
        {error !== null && (
          <div className="px-5 py-3">
            <Banner tone="error">{error}</Banner>
          </div>
        )}
        {notice !== null && (
          <div className="px-5 py-3">
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
              value={form.name}
              placeholder="Neko / DeepSeek / 自建"
              aria-label="服务名称"
              onChange={(event) => patch({ name: event.target.value })}
            />
          }
        />

        <SettingRow
          id="pi.protocol"
          title="API 协议"
          description="运行时的传输协议；决定请求发到哪个端点、用哪套格式。"
          control={
            <Select
              className="w-56"
              value={form.protocol}
              aria-label="API 协议"
              onChange={(next) => patch({ protocol: next as ModelProtocol })}
              options={[
                { value: 'openai-completions', label: 'Chat Completions' },
                { value: 'openai-responses', label: 'Responses' },
                { value: 'anthropic-messages', label: 'Messages' },
              ]}
            />
          }
        />

        <SettingRow
          id="pi.baseUrl"
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
          id="pi.models"
          title="模型"
          description={`已获取 ${String(form.models.length)} 个；选择后会填入模型 ID。`}
          control={
            <Select
              className="w-56"
              value={form.models.some((model) => model.id === form.modelId) ? form.modelId : ''}
              aria-label="模型"
              onChange={(next) => patch({ modelId: next })}
              options={[
                { value: '', label: '手动输入 / 未选择' },
                ...form.models.map((model) => ({ value: model.id, label: model.name ?? model.id })),
              ]}
            />
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
          id="pi.modelImage"
          title="图片输入"
          description={
            hasModel
              ? '这个模型能否接收图片；运行时会拒绝没有声明的模型。'
              : '先填写模型 ID 或从上面的列表选一个。'
          }
          control={
            <Switch
              label="图片输入"
              checked={capabilities.image}
              disabled={!hasModel}
              onChange={(next) => setCapability({ image: next })}
            />
          }
        />

        <SettingRow
          id="pi.modelReasoning"
          title="推理"
          description="模型会先输出思考过程，界面把它折叠成一行。"
          control={
            <Switch
              label="推理"
              checked={capabilities.reasoning}
              disabled={!hasModel}
              onChange={(next) => setCapability({ reasoning: next })}
            />
          }
        />

        {/* Only meaningful once the model declares reasoning: a level offered for a
            model that ignores the switch would be a choice that does nothing. */}
        {capabilities.reasoning && (
          <SettingRow
            id="pi.modelEfforts"
            title="推理强度"
            description="输入框里能选的档位，最弱在前；不选就是端点的默认行为。"
            control={
              <div className="flex flex-wrap justify-end gap-1">
                {MODEL_EFFORTS.map((level) => {
                  const on = (capabilities.efforts ?? []).includes(level)
                  return (
                    <button
                      key={level}
                      type="button"
                      aria-pressed={on}
                      aria-label={`推理强度 ${effortLabel(level)}`}
                      onClick={() => toggleEffort(level)}
                      className={cn(
                        'rounded-md border px-2 py-0.5 text-2xs transition-colors duration-150',
                        on
                          ? 'border-accent/40 bg-accent/10 text-accent'
                          : 'border-border text-faint hover:border-border-strong hover:text-muted',
                      )}
                    >
                      {effortLabel(level)}
                    </button>
                  )
                })}
              </div>
            }
          />
        )}

        {/* What the composer selects the moment this model is picked. Without it,
            switching models would silently drop back to sending no level. */}
        {capabilities.reasoning && capabilities.efforts.length > 0 && (
          <SettingRow
            id="pi.modelDefaultEffort"
            title="默认强度"
            description="在输入框里选中这个模型时自动使用这一档。"
            control={
              <Select
                aria-label="默认强度"
                className="w-32"
                value={capabilities.defaultEffort ?? OMIT_EFFORT}
                onChange={(next) =>
                  setCapability({
                    defaultEffort: capabilities.efforts.find((level) => level === next) ?? null,
                  })
                }
                options={[
                  { value: OMIT_EFFORT, label: OMIT_EFFORT },
                  ...capabilities.efforts.map((level) => ({
                    value: level,
                    label: effortLabel(level),
                  })),
                ]}
              />
            }
          />
        )}

        <SettingRow
          id="pi.modelContext"
          title="上下文窗口"
          description="留空表示未知，由端点自行决定。"
          control={
            <Input
              type="number"
              min={1}
              className="w-32 font-mono"
              placeholder="例如 128000"
              aria-label="上下文窗口"
              disabled={!hasModel}
              value={capabilities.contextWindow ?? ''}
              onChange={(event) => setCapability({ contextWindow: limitOf(event.target.value) })}
            />
          }
        />

        <SettingRow
          id="pi.modelMaxTokens"
          title="最大输出"
          description="单次回复的 token 上限；留空表示未知。"
          control={
            <Input
              type="number"
              min={1}
              className="w-32 font-mono"
              placeholder="例如 8192"
              aria-label="最大输出"
              disabled={!hasModel}
              value={capabilities.maxTokens ?? ''}
              onChange={(event) => setCapability({ maxTokens: limitOf(event.target.value) })}
            />
          }
        />

        <SettingRow
          id="pi.apiKey"
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

        <div className="flex flex-wrap items-center gap-2 px-5 py-3">
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
                // The endpoint says which models exist; the capabilities already
                // typed here are ours, so they survive the refresh.
                patch({
                  models: mergeModels(form.models, models),
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
          {provider !== null && (
            <Badge tone={provider.hasApiKey ? 'success' : 'neutral'} className="ml-auto">
              {provider.hasApiKey ? '密钥已保存' : '未设置密钥'}
            </Badge>
          )}
        </div>
      </div>
    </Dialog>
  )
}
