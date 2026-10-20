import { Download, Loader2, Radar } from 'lucide-react'
import { useState } from 'react'

import type { CcSwitchScanResult } from '../../../../shared/bridge.js'
import { Badge, Banner, Button, EmptyState, Switch } from '../../components/ui/index.js'
import { cn } from '../../lib/cn.js'
import { Section } from './Section.js'

export function CcSwitchSection(): React.JSX.Element {
  const [scan, setScan] = useState<CcSwitchScanResult | null>(null)
  const [selected, setSelected] = useState('')
  const [includeKey, setIncludeKey] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

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
      title="从 cc-switch 导入"
      description="只读扫描本机 cc-switch 的 provider 配置，可选择是否一并导入密钥。"
      actions={
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const result = await window.pictor.scanCcSwitch()
              setScan(result)
              setSelected(result.providers[0]?.id ?? '')
              if (!result.available) setNotice('未找到 cc-switch 数据库')
            })
          }
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Radar className="size-3.5" />}
          扫描
        </Button>
      }
    >
      {error !== null && <Banner tone="error">{error}</Banner>}
      {notice !== null && <Banner tone="notice">{notice}</Banner>}

      {scan === null ? (
        <p className="text-xs text-faint">尚未扫描。点击右上角「扫描」读取本机配置。</p>
      ) : scan.providers.length === 0 ? (
        <EmptyState title="没有可导入的 provider" description={scan.path} />
      ) : (
        <>
          <ul className="flex flex-col gap-1">
            {scan.providers.map((provider) => {
              const active = provider.id === selected
              return (
                <li key={provider.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(provider.id)}
                    className={cn(
                      'flex w-full flex-col gap-1 rounded-md border px-3 py-2 text-left transition-colors duration-150',
                      active
                        ? 'border-accent/40 bg-accent/5'
                        : 'border-border bg-surface hover:bg-surface-hover',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate text-xs text-text">{provider.name}</span>
                      <Badge tone={provider.hasApiKey ? 'success' : 'neutral'} className="shrink-0">
                        {provider.hasApiKey ? '有密钥' : '无密钥'}
                      </Badge>
                      <span className="ml-auto shrink-0 text-2xs text-faint">
                        {provider.models.length} 个模型
                      </span>
                    </span>
                    <span className="truncate font-mono text-2xs text-faint">
                      {provider.baseUrl}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>

          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs text-muted">
              <Switch label="同时导入 API Key" checked={includeKey} onChange={setIncludeKey} />
              同时导入 API Key
            </label>

            <Button
              variant="primary"
              size="sm"
              disabled={busy || selected.length === 0}
              onClick={() =>
                void run(async () => {
                  await window.pictor.importCcSwitchProvider(selected, includeKey)
                  setNotice('已导入配置，可在上方核对并保存')
                })
              }
            >
              <Download className="size-3.5" />
              导入所选
            </Button>
          </div>
        </>
      )}
    </Section>
  )
}
