import { CheckCircle2, KeyRound, LoaderCircle, Server, Trash2 } from 'lucide-react'
import { useState } from 'react'

import {
  modelSettingsInputSchema,
  type ConnectionTestResult,
  type ModelSettings,
} from '../../shared/contracts'
import { Modal } from './Modal'

interface SettingsDialogProps {
  initial: ModelSettings | null
  onClose: () => void
  onSaved: (settings: ModelSettings) => void
}

interface FormState {
  baseUrl: string
  modelId: string
  apiKey: string
  temperature: string
  maxOutputTokens: string
  clearApiKey: boolean
}

function createFormState(settings: ModelSettings | null): FormState {
  return {
    baseUrl: settings?.baseUrl ?? 'https://api.openai.com/v1',
    modelId: settings?.modelId ?? '',
    apiKey: '',
    temperature: settings?.temperature?.toString() ?? '',
    maxOutputTokens: settings?.maxOutputTokens?.toString() ?? '',
    clearApiKey: false,
  }
}

export function SettingsDialog({
  initial,
  onClose,
  onSaved,
}: SettingsDialogProps): React.JSX.Element {
  const [form, setForm] = useState(() => createFormState(initial))
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<'save' | 'test' | null>(null)
  const [feedback, setFeedback] = useState<ConnectionTestResult | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const update = (field: keyof FormState, value: string | boolean) => {
    setForm((current) => ({ ...current, [field]: value }))
    setFieldErrors((current) => ({ ...current, [field]: '' }))
    setFeedback(null)
  }

  const parseSettings = () => {
    const result = modelSettingsInputSchema.safeParse({
      baseUrl: form.baseUrl,
      modelId: form.modelId,
      temperature: form.temperature.trim() ? Number(form.temperature) : null,
      maxOutputTokens: form.maxOutputTokens.trim() ? Number(form.maxOutputTokens) : null,
    })
    if (result.success) {
      setFieldErrors({})
      return result.data
    }
    const errors: Record<string, string> = {}
    for (const issue of result.error.issues) {
      const field = String(issue.path[0] ?? 'form')
      errors[field] ??= issue.message
    }
    setFieldErrors(errors)
    return null
  }

  const handleTest = async () => {
    const settings = parseSettings()
    if (!settings) return
    if (form.clearApiKey || (!form.apiKey.trim() && !initial?.hasApiKey)) {
      setFieldErrors((current) => ({ ...current, apiKey: '请输入 API Key 以测试连接' }))
      return
    }
    setBusy('test')
    setFormError(null)
    const response = await window.pictor.testSettings({
      ...settings,
      ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
    })
    setBusy(null)
    if (response.ok) setFeedback(response.value)
    else setFormError(response.error.message)
  }

  const handleSave = async () => {
    const settings = parseSettings()
    if (!settings) return
    setBusy('save')
    setFormError(null)
    const apiKey = form.clearApiKey
      ? ({ action: 'clear' } as const)
      : form.apiKey.trim()
        ? ({ action: 'replace', value: form.apiKey.trim() } as const)
        : ({ action: 'keep' } as const)
    const response = await window.pictor.saveSettings({ ...settings, apiKey })
    setBusy(null)
    if (!response.ok) {
      setFormError(response.error.message)
      if (response.error.field) {
        setFieldErrors((current) => ({
          ...current,
          [response.error.field as string]: response.error.message,
        }))
      }
      return
    }
    onSaved(response.value)
    onClose()
  }

  return (
    <Modal
      title="模型 API 设置"
      description="配置一个支持流式响应和工具调用的 OpenAI 兼容端点。"
      onClose={onClose}
      width="wide"
    >
      <div className="settings-form">
        <label className="field field--full">
          <span>API Base URL</span>
          <div className="input-with-icon">
            <Server size={15} />
            <input
              value={form.baseUrl}
              placeholder="https://api.example.com/v1"
              onChange={(event) => update('baseUrl', event.target.value)}
              aria-invalid={Boolean(fieldErrors.baseUrl)}
              autoFocus
            />
          </div>
          {fieldErrors.baseUrl ? (
            <small className="field-error">{fieldErrors.baseUrl}</small>
          ) : null}
        </label>

        <label className="field field--full">
          <span>模型</span>
          <input
            value={form.modelId}
            placeholder="例如 gpt-5"
            onChange={(event) => update('modelId', event.target.value)}
            aria-invalid={Boolean(fieldErrors.modelId)}
          />
          {fieldErrors.modelId ? (
            <small className="field-error">{fieldErrors.modelId}</small>
          ) : null}
        </label>

        <label className="field field--full">
          <span>API Key</span>
          <div className="credential-row">
            <div className="input-with-icon">
              <KeyRound size={15} />
              <input
                type="password"
                value={form.apiKey}
                disabled={form.clearApiKey}
                placeholder={initial?.hasApiKey ? '已安全保存；留空保持不变' : '输入 API Key'}
                autoComplete="off"
                onChange={(event) => update('apiKey', event.target.value)}
                aria-invalid={Boolean(fieldErrors.apiKey)}
              />
            </div>
            {initial?.hasApiKey ? (
              <button
                className={`secondary-button ${form.clearApiKey ? 'is-danger' : ''}`}
                type="button"
                onClick={() => update('clearApiKey', !form.clearApiKey)}
              >
                <Trash2 size={14} />
                {form.clearApiKey ? '取消清除' : '清除'}
              </button>
            ) : null}
          </div>
          {fieldErrors.apiKey ? <small className="field-error">{fieldErrors.apiKey}</small> : null}
          {form.clearApiKey ? (
            <small className="field-warning">保存后将删除已加密凭据。</small>
          ) : null}
        </label>

        <label className="field">
          <span>温度</span>
          <input
            type="number"
            min="0"
            max="2"
            step="0.1"
            value={form.temperature}
            placeholder="服务端默认"
            onChange={(event) => update('temperature', event.target.value)}
            aria-invalid={Boolean(fieldErrors.temperature)}
          />
          {fieldErrors.temperature ? (
            <small className="field-error">{fieldErrors.temperature}</small>
          ) : null}
        </label>

        <label className="field">
          <span>最大输出 Token</span>
          <input
            type="number"
            min="1"
            max="1000000"
            step="1"
            value={form.maxOutputTokens}
            placeholder="服务端默认"
            onChange={(event) => update('maxOutputTokens', event.target.value)}
            aria-invalid={Boolean(fieldErrors.maxOutputTokens)}
          />
          {fieldErrors.maxOutputTokens ? (
            <small className="field-error">{fieldErrors.maxOutputTokens}</small>
          ) : null}
        </label>
      </div>

      {feedback ? (
        <div className={`connection-result connection-result--${feedback.outcome}`} role="status">
          <CheckCircle2 size={16} />
          <span>{feedback.message}</span>
        </div>
      ) : null}
      {formError ? (
        <div className="form-error" role="alert">
          {formError}
        </div>
      ) : null}

      <footer className="modal-actions">
        <button
          className="secondary-button"
          type="button"
          onClick={handleTest}
          disabled={busy !== null}
        >
          {busy === 'test' ? <LoaderCircle className="spin" size={15} /> : null}
          测试连接
        </button>
        <span className="action-spacer" />
        <button
          className="secondary-button"
          type="button"
          onClick={onClose}
          disabled={busy !== null}
        >
          取消
        </button>
        <button
          className="primary-button"
          type="button"
          onClick={handleSave}
          disabled={busy !== null}
        >
          {busy === 'save' ? <LoaderCircle className="spin" size={15} /> : null}
          保存设置
        </button>
      </footer>
    </Modal>
  )
}
