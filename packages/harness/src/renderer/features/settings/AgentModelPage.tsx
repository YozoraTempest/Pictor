import { Download, FlaskConical, Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { piProviderPlan } from '@vulonlok/shared'
import type { ProviderList, ProviderView } from '@vulonlok/shared'

import { Badge, Button, Dialog, IconButton, Tooltip } from '@vulonlok/ui'
import { cn } from '@vulonlok/ui/cn'
import { AgentTestDialog } from './AgentTestDialog.js'
import { ImportDialog } from './ImportDialog.js'
import { ProviderDialog } from './ProviderDialog.js'
import { capabilitiesOf } from './models.js'
import { Section } from './Section.js'

/** Host part of the endpoint, for the row's secondary line. */
function hostOf(baseUrl: string): string {
  if (baseUrl.length === 0) return '未配置端点'
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl
  }
}

/** A context window the way people say it: 128k, 1M. */
function contextLabel(tokens: number): string {
  if (tokens >= 1_000_000) return `${String(Math.round(tokens / 100_000) / 10)}M`
  return `${String(Math.round(tokens / 1000))}k`
}

/** What the active model declared, in the row's own shorthand. */
function capabilityHints(provider: ProviderView): string {
  const capabilities = capabilitiesOf(
    provider.models.find((model) => model.id === provider.modelId),
  )
  return [
    capabilities.image ? '图' : null,
    capabilities.reasoning ? '思考' : null,
    capabilities.contextWindow === null
      ? null
      : `${contextLabel(capabilities.contextWindow)} 上下文`,
  ]
    .filter((hint): hint is string => hint !== null)
    .join(' · ')
}

function isUsable(provider: ProviderView): boolean {
  return provider.baseUrl.length > 0 && provider.modelId.length > 0
}

/**
 * Every model endpoint, and the one the runtime uses.
 *
 * The page is the list and nothing else: a service is a record, so opening one to
 * edit it, importing one, or running a test are all dialogs. Keeping those off the
 * page is what stops "connect", "configure" and "run" from looking like three
 * siblings of the same list.
 */
export function AgentModelPage(): React.JSX.Element {
  const [list, setList] = useState<ProviderList | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** `undefined` closes the editor; `null` opens it in add mode. */
  const [editing, setEditing] = useState<ProviderView | null | undefined>(undefined)
  const [importing, setImporting] = useState(false)
  const [testing, setTesting] = useState(false)
  const [removing, setRemoving] = useState<ProviderView | null>(null)

  useEffect(() => {
    void window.pictor
      .listProviders()
      .then(setList)
      .catch((reason: unknown) => setError(String(reason)))
  }, [])

  function apply(next: ProviderList): void {
    setList(next)
    setError(null)
  }

  async function activate(id: string): Promise<void> {
    try {
      apply(await window.pictor.activateProvider(id))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  async function remove(id: string): Promise<void> {
    try {
      apply(await window.pictor.removeProvider(id))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const providers = list?.providers ?? []

  return (
    <>
      <Section
        title="AI 服务"
        description="会话使用「使用中」的服务。点击一行可编辑。"
        actions={
          <>
            <Tooltip label="用当前服务跑一次最简调用" side="bottom" align="end">
              <Button
                variant="ghost"
                size="sm"
                disabled={providers.length === 0}
                onClick={() => setTesting(true)}
              >
                <FlaskConical className="size-3.5" />
                试运行
              </Button>
            </Tooltip>
            <Button variant="secondary" size="sm" onClick={() => setImporting(true)}>
              <Download className="size-3.5" />
              从其他工具导入
            </Button>
            <Button variant="primary" size="sm" onClick={() => setEditing(null)}>
              <Plus className="size-3.5" />
              添加服务
            </Button>
          </>
        }
        padded={false}
      >
        {list === null ? (
          <p className="px-4 py-3 text-xs text-faint">读取配置…</p>
        ) : providers.length === 0 ? (
          <p className="px-4 py-3 text-xs text-faint">
            还没有服务。点「添加服务」或从其他工具导入一条配置。
          </p>
        ) : (
          providers.map((provider) => {
            const active = provider.id === list.activeId
            // Computed once per row; the row shows it in one place.
            const hints = capabilityHints(provider)
            // The same service Pi will register, or why it cannot: the whole point of
            // one configuration is that a person can see where it actually reaches.
            const pi = piProviderPlan(provider)

            return (
              <div
                key={provider.id}
                className="group flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-surface-hover/40"
              >
                <button
                  type="button"
                  aria-label={active ? `${provider.name} 使用中` : `使用 ${provider.name}`}
                  aria-pressed={active}
                  onClick={() => void activate(provider.id)}
                  className={cn(
                    'grid size-4 shrink-0 place-items-center rounded-full border transition-colors duration-150',
                    active ? 'border-accent' : 'border-border-strong hover:border-muted',
                  )}
                >
                  {active && <span className="size-2 rounded-full bg-accent" />}
                </button>

                <button
                  type="button"
                  onClick={() => setEditing(provider)}
                  className="flex min-w-0 flex-1 flex-col gap-0.5 text-left"
                >
                  <span className="flex items-center gap-2">
                    <span className="truncate text-xs text-text">
                      {provider.name.length > 0 ? provider.name : '未命名服务'}
                    </span>
                    {!isUsable(provider) && <Badge tone="neutral">待补全</Badge>}
                  </span>
                  <span className="truncate text-2xs text-faint">
                    {hostOf(provider.baseUrl)} · {String(provider.models.length)} 个模型
                    {provider.modelId.length > 0 ? ` · ${provider.modelId}` : ''}
                    {hints.length > 0 ? ` · ${hints}` : ''}
                  </span>
                  <span className={cn('truncate text-2xs', pi.ok ? 'text-faint' : 'text-faint/70')}>
                    {pi.ok
                      ? `Pi 可用：${pi.name} · ${String(pi.models)} 个模型`
                      : `Pi 用不了：${pi.reason}`}
                  </span>
                </button>

                <Badge tone={provider.hasApiKey ? 'success' : 'neutral'}>
                  {provider.hasApiKey ? '有密钥' : '无密钥'}
                </Badge>

                <IconButton
                  label={`编辑 ${provider.name}`}
                  className="size-6"
                  onClick={() => setEditing(provider)}
                >
                  <Pencil className="size-3" />
                </IconButton>

                <IconButton
                  label={`移除 ${provider.name}`}
                  className="size-6"
                  onClick={() => setRemoving(provider)}
                >
                  <Trash2 className="size-3" />
                </IconButton>
              </div>
            )
          })
        )}

        {error !== null && <p className="px-4 py-3 text-xs text-danger">{error}</p>}
      </Section>

      <ProviderDialog
        key={editing === undefined || editing === null ? 'new' : editing.id}
        open={editing !== undefined}
        provider={editing ?? null}
        active={editing !== null && editing !== undefined && editing.id === list?.activeId}
        onSaved={apply}
        onClose={() => setEditing(undefined)}
      />

      <ImportDialog open={importing} onImported={apply} onClose={() => setImporting(false)} />

      <AgentTestDialog open={testing} onClose={() => setTesting(false)} />

      <Dialog
        open={removing !== null}
        title="移除服务？"
        onClose={() => setRemoving(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              取消
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const target = removing
                setRemoving(null)
                if (target !== null) void remove(target.id)
              }}
            >
              移除
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-muted">
          「{removing?.name ?? ''}」的配置与本机保存的密钥都会被删除，此操作不可撤销。
          {removing !== null && removing.id === list?.activeId
            ? '它是当前使用中的服务，移除后会自动切换到下一个。'
            : ''}
        </p>
      </Dialog>
    </>
  )
}
