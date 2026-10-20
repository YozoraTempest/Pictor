import { useEffect, useState } from 'react'

import type { ModelEntry, ModelProtocol, ModelSettings } from '@pictor/shared'

import type { AgentTestResult, CcSwitchScanResult, ModelProbeResult } from '../../shared/bridge.js'

interface Props {
  workingDirectory: string
}

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

export function ModelSettingsPanel({ workingDirectory }: Props): React.JSX.Element {
  const [form, setForm] = useState<FormState>(EMPTY)
  const [saved, setSaved] = useState<ModelSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [probe, setProbe] = useState<ModelProbeResult | null>(null)
  const [scan, setScan] = useState<CcSwitchScanResult | null>(null)
  const [selectedProvider, setSelectedProvider] = useState('')
  const [includeKey, setIncludeKey] = useState(true)
  const [prompt, setPrompt] = useState('用一个短句介绍你自己')
  const [test, setTest] = useState<AgentTestResult | null>(null)

  useEffect(() => {
    void (async () => {
      const settings = await window.pictor.getModelSettings()
      setSaved(settings)
      setForm(toForm(settings))
    })().catch((reason: unknown) => setError(String(reason)))
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
    <section className="panel settings">
      <div className="settings-head">
        <h2>Model settings</h2>
        <span className={saved?.hasApiKey === true ? 'pill ok' : 'pill'}>
          {saved?.hasApiKey === true ? 'API key stored' : 'No API key'}
        </span>
      </div>

      {error !== null && <div className="error">{error}</div>}
      {notice !== null && <div className="notice">{notice}</div>}

      <div className="settings-grid">
        <label className="field">
          <span>服务名称</span>
          <input
            value={form.providerName}
            onChange={(event) => patch({ providerName: event.target.value })}
            placeholder="Neko / DeepSeek / 自建"
          />
        </label>

        <label className="field">
          <span>Base URL</span>
          <input
            value={form.baseUrl}
            onChange={(event) => patch({ baseUrl: event.target.value })}
            placeholder="https://api.example.com/v1"
          />
        </label>

        <label className="field">
          <span>API 风格</span>
          <select
            value={form.protocol}
            onChange={(event) => patch({ protocol: event.target.value as ModelProtocol })}
          >
            <option value="chat-completions">Chat Completions</option>
            <option value="responses">Responses</option>
          </select>
        </label>

        <label className="field">
          <span>模型</span>
          <select
            value={form.models.some((model) => model.id === form.modelId) ? form.modelId : ''}
            onChange={(event) => patch({ modelId: event.target.value })}
          >
            <option value="">手动输入 / 未选择</option>
            {form.models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name ?? model.id}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>模型 ID</span>
          <input
            value={form.modelId}
            onChange={(event) => patch({ modelId: event.target.value })}
            placeholder="deepseek-v4.1-flash"
          />
        </label>

        <label className="field">
          <span>API Key</span>
          <input
            type="password"
            value={form.apiKey}
            onChange={(event) => patch({ apiKey: event.target.value })}
            placeholder={saved?.hasApiKey === true ? '已保存，留空表示不修改' : '粘贴 API Key'}
          />
        </label>
      </div>

      <div className="actions">
        <button
          type="button"
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
        </button>

        <button
          type="button"
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
              setNotice(`获取到 ${models.length} 个模型（保存后生效）`)
            })
          }
        >
          获取模型
        </button>

        <button
          type="button"
          disabled={busy || saved === null}
          onClick={() =>
            void run(async () => {
              const result = await window.pictor.testModelConnection()
              setProbe(result)
            })
          }
        >
          测试连接
        </button>
      </div>

      {probe !== null && (
        <div className={probe.ok ? 'probe ok' : 'probe bad'}>
          <strong>{probe.ok ? '连接成功' : '连接失败'}</strong>
          <span>{probe.message}</span>
          {probe.sample.length > 0 && <code>{probe.sample}</code>}
        </div>
      )}

      <div className="settings-block">
        <h3>从 cc-switch 导入</h3>
        <div className="actions">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await window.pictor.scanCcSwitch()
                setScan(result)
                setSelectedProvider(result.providers[0]?.id ?? '')
                if (!result.available) setNotice('未找到 cc-switch 数据库')
              })
            }
          >
            扫描
          </button>
          <label className="toggle">
            <input
              type="checkbox"
              checked={includeKey}
              onChange={(event) => setIncludeKey(event.target.checked)}
            />
            同时导入 API Key
          </label>
          <button
            type="button"
            disabled={busy || selectedProvider.length === 0}
            onClick={() =>
              void run(async () => {
                const next = await window.pictor.importCcSwitchProvider(
                  selectedProvider,
                  includeKey,
                )
                setSaved(next)
                setForm(toForm(next))
                setNotice('已从 cc-switch 导入配置')
              })
            }
          >
            导入所选
          </button>
        </div>

        {scan !== null && (
          <ul className="list compact">
            {scan.providers.length === 0 && <li className="muted">没有可导入的 pi provider</li>}
            {scan.providers.map((provider) => (
              <li key={provider.id}>
                <label className="toggle">
                  <input
                    type="radio"
                    name="ccswitch-provider"
                    checked={selectedProvider === provider.id}
                    onChange={() => setSelectedProvider(provider.id)}
                  />
                  {provider.name}
                </label>
                <span className="path">{provider.baseUrl}</span>
                <span className="muted">{provider.models.length} 模型</span>
                <span className="badge">{provider.hasApiKey ? '有密钥' : '无密钥'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="settings-block">
        <h3>试运行</h3>
        <div className="row">
          <input value={prompt} onChange={(event) => setPrompt(event.target.value)} />
          <button
            type="button"
            disabled={busy || saved === null || prompt.trim().length === 0}
            onClick={() =>
              void run(async () => {
                setTest(null)
                const result = await window.pictor.runAgentTest(prompt, workingDirectory)
                setTest(result)
              })
            }
          >
            运行 Agent
          </button>
        </div>
        {test !== null && (
          <pre className="output">
            {test.ok ? test.text : (test.message ?? '运行失败')}
            {'\n\n'}
            events: {test.events.join(', ')}
          </pre>
        )}
      </div>
    </section>
  )
}
