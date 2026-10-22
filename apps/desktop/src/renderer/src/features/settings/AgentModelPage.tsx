import { Check, Download, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { ProviderList, ProviderView } from '@pictor/shared'

import { Badge, Button, Dialog, IconButton, Tooltip } from '../../components/ui/index.js'
import { cn } from '../../lib/cn.js'
import { AgentTestSection } from './AgentTestSection.js'
import { CcSwitchSection } from './CcSwitchSection.js'
import { ProviderEditor } from './ProviderEditor.js'
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

function isUsable(provider: ProviderView): boolean {
  return provider.baseUrl.length > 0 && provider.modelId.length > 0
}

/** Page-level actions, shown beside the 模型 heading. */
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

      <Dialog open={importing} title="从其他工具导入" onClose={() => setImporting(false)}>
        <CcSwitchSection />
      </Dialog>
    </>
  )
}

/**
 * Every model endpoint, and the one the runtime uses.
 *
 * The list is the page's spine: a row says what the service is and whether it is
 * the active one, and the editor below always edits the selected row. Adding is
 * the same editor with nothing selected, so there is one form to learn.
 */
export function AgentModelPage(): React.JSX.Element {
  const [list, setList] = useState<ProviderList | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<ProviderView | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.pictor
      .listProviders()
      .then((next) => {
        setList(next)
        setSelectedId(next.activeId ?? next.providers[0]?.id ?? null)
      })
      .catch((reason: unknown) => setError(String(reason)))
  }, [])

  function apply(next: ProviderList): void {
    setList(next)
    setAdding(false)
    setSelectedId((current) =>
      current !== null && next.providers.some((provider) => provider.id === current)
        ? current
        : (next.activeId ?? next.providers[0]?.id ?? null),
    )
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
  const selected = providers.find((provider) => provider.id === selectedId) ?? null
  const editing = adding ? null : selected

  return (
    <>
      <Section
        title="AI 服务"
        description="会话使用「使用中」的那一个服务与模型对话。"
        actions={
          <Button
            variant="primary"
            size="sm"
            disabled={adding}
            onClick={() => {
              setAdding(true)
            }}
          >
            <Plus className="size-3.5" />
            添加服务
          </Button>
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
            const current = provider.id === selectedId && !adding

            return (
              <div
                key={provider.id}
                className={cn(
                  'flex items-center gap-3 px-4 py-3 transition-colors duration-150',
                  current && 'bg-surface-hover/60',
                )}
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
                  onClick={() => {
                    setAdding(false)
                    setSelectedId(provider.id)
                  }}
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
                  </span>
                </button>

                <Badge tone={provider.hasApiKey ? 'success' : 'neutral'}>
                  {provider.hasApiKey ? '有密钥' : '无密钥'}
                </Badge>

                {active ? (
                  <Tooltip label="正在使用" side="bottom" align="end">
                    <span className="grid size-6 place-items-center text-accent">
                      <Check className="size-3.5" />
                    </span>
                  </Tooltip>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => void activate(provider.id)}>
                    使用
                  </Button>
                )}

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

      {(selected !== null || adding) && (
        <ProviderEditor
          key={editing?.id ?? 'new'}
          provider={editing}
          active={editing !== null && editing.id === list?.activeId}
          onSaved={apply}
          onDismiss={() => setAdding(false)}
        />
      )}

      <AgentTestSection />

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
