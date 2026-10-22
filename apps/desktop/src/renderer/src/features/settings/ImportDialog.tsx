import { Download, Loader2, Radar } from 'lucide-react'
import { useState } from 'react'

import type { ProviderList } from '@pictor/shared'

import type { CcSwitchScanResult } from '../../../../shared/bridge.js'
import { Badge, Banner, Button, Dialog, EmptyState, Switch } from '../../components/ui/index.js'
import { cn } from '../../lib/cn.js'

/**
 * Imports a provider from cc-switch.
 *
 * The scan, the choice and the import all live in one dialog because they are one
 * task: the page behind it is the result, and it is refreshed by `onImported`
 * rather than by an implicit reload nobody can see.
 */
export function ImportDialog({
  open,
  onImported,
  onClose,
}: {
  open: boolean
  onImported: (list: ProviderList) => void
  onClose: () => void
}): React.JSX.Element {
  const [scan, setScan] = useState<CcSwitchScanResult | null>(null)
  const [selected, setSelected] = useState('')
  const [includeKey, setIncludeKey] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  function scanNow(): void {
    void run(async () => {
      const result = await window.pictor.scanCcSwitch()
      setScan(result)
      setSelected(result.providers[0]?.id ?? '')
    })
  }

  return (
    <Dialog
      open={open}
      title="从其他工具导入"
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto text-2xs text-faint">
            导入会新增一条服务并设为使用中，不影响已保存的配置。
          </span>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button variant="secondary" size="sm" disabled={busy} onClick={scanNow}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Radar className="size-3.5" />}
            扫描
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={busy || selected.length === 0}
            onClick={() =>
              void run(async () => {
                const list = await window.pictor.importCcSwitchProvider(selected, includeKey)
                onImported(list)
                onClose()
              })
            }
          >
            <Download className="size-3.5" />
            导入所选
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs leading-relaxed text-muted">
          只读扫描本机 cc-switch 的 provider 配置。导入后可在列表里编辑，密钥按服务分别保存。
        </p>

        {error !== null && <Banner tone="error">{error}</Banner>}

        {scan === null ? (
          <p className="rounded-md border border-border bg-bg px-3 py-6 text-center text-xs text-faint">
            尚未扫描。点下方「扫描」读取本机配置。
          </p>
        ) : scan.providers.length === 0 ? (
          <EmptyState
            title={scan.available ? '没有可导入的 provider' : '未找到 cc-switch 数据库'}
            description={scan.path}
          />
        ) : (
          <>
            <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto pr-1">
              {scan.providers.map((provider) => {
                const active = provider.id === selected
                return (
                  <li key={provider.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(provider.id)}
                      aria-pressed={active}
                      className={cn(
                        'flex w-full flex-col gap-1 rounded-md border px-3 py-2 text-left transition-colors duration-150',
                        active
                          ? 'border-accent/40 bg-accent/5'
                          : 'border-border bg-surface hover:bg-surface-hover',
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span className="truncate text-xs text-text">{provider.name}</span>
                        <Badge
                          tone={provider.hasApiKey ? 'success' : 'neutral'}
                          className="shrink-0"
                        >
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

            <label className="flex items-center gap-2 text-xs text-muted">
              <Switch label="同时导入 API Key" checked={includeKey} onChange={setIncludeKey} />
              同时导入 API Key
            </label>
          </>
        )}
      </div>
    </Dialog>
  )
}
