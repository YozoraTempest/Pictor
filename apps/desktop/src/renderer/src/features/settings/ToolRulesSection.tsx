import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { ToolRule, ToolRuleEffect } from '@pictor/shared'

import { Badge, Button, Input } from '../../components/ui/index.js'
import { cn } from '../../lib/cn.js'
import { Section } from './Section.js'
import { SettingRow } from './SettingRow.js'

/** Tools worth offering as a hint; the field stays free text for the rest. */
const KNOWN_TOOLS = ['bash', 'write', 'edit', 'read', 'web_fetch', 'web_search', 'subagent']

function describe(rule: ToolRule): string {
  const scope = rule.tool === '*' ? '所有工具' : rule.tool
  return rule.pattern.length === 0 ? scope : `${scope}(${rule.pattern})`
}

/**
 * Per-tool policy: what the agent may never do, and what it need not ask about.
 *
 * The two halves are not symmetric, and the page says so. A deny sees the real
 * arguments and refuses the call, so its pattern is exact. An allow cannot: the
 * runtime's escalation prompt carries only the tool name, so an allow answers
 * that prompt for the whole tool and ignores its pattern.
 */
export function ToolRulesSection(): React.JSX.Element {
  const [rules, setRules] = useState<ToolRule[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [effect, setEffect] = useState<ToolRuleEffect>('deny')
  const [tool, setTool] = useState('bash')
  const [pattern, setPattern] = useState('')

  useEffect(() => {
    let alive = true
    void window.pictor
      .listToolRules()
      .then((next) => {
        if (alive) setRules(next)
      })
      .catch((reason: unknown) => {
        if (!alive) return
        setRules([])
        setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      alive = false
    }
  }, [])

  async function persist(next: ToolRule[]): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      setRules(await window.pictor.saveToolRules(next))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  function add(): void {
    const name = tool.trim()
    if (name.length === 0) return
    const rule: ToolRule = {
      id: crypto.randomUUID(),
      effect,
      tool: name,
      pattern: pattern.trim(),
    }
    void persist([...(rules ?? []), rule])
    setPattern('')
  }

  return (
    <Section
      title="工具规则"
      description="按工具限制 agent 能做什么。拒绝会直接拦下这次调用；允许只用于替你回答该工具的升权确认。"
      actions={
        <Badge tone="neutral">
          {(rules ?? []).filter((rule) => rule.effect === 'deny').length} 拒绝 /{' '}
          {(rules ?? []).filter((rule) => rule.effect === 'allow').length} 允许
        </Badge>
      }
      padded={false}
    >
      {(rules ?? []).map((rule) => (
        <SettingRow
          key={rule.id}
          title={describe(rule)}
          description={
            rule.effect === 'deny'
              ? '匹配到这次调用的参数就拒绝，不会执行'
              : '该工具的升权确认自动同意；参数不参与匹配'
          }
          control={
            <div className="flex items-center gap-2">
              <Badge tone={rule.effect === 'deny' ? 'danger' : 'neutral'}>
                {rule.effect === 'deny' ? '拒绝' : '允许'}
              </Badge>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`删除规则 ${describe(rule)}`}
                disabled={busy}
                onClick={() => void persist((rules ?? []).filter((entry) => entry.id !== rule.id))}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          }
        />
      ))}

      {rules !== null && rules.length === 0 && (
        <SettingRow
          title="还没有规则"
          description="例如拒绝 bash(npm publish*)：模型想发布包时会被直接拦下。"
          control={null}
        />
      )}

      <SettingRow
        stacked
        title="新增规则"
        description="模式支持 * 通配；留空表示该工具的任何参数。"
        control={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-md border border-border">
              {(['deny', 'allow'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={effect === value}
                  onClick={() => setEffect(value)}
                  className={cn(
                    'px-2.5 py-1.5 text-2xs transition-colors duration-150',
                    effect === value
                      ? value === 'deny'
                        ? 'bg-danger/15 text-danger'
                        : 'bg-accent/15 text-accent'
                      : 'text-muted hover:bg-surface-hover',
                  )}
                >
                  {value === 'deny' ? '拒绝' : '允许'}
                </button>
              ))}
            </div>
            <Input
              aria-label="工具名"
              value={tool}
              list="pictor-known-tools"
              placeholder="bash，或 * 表示全部"
              onChange={(event) => setTool(event.target.value)}
              className="h-8 w-40 text-xs"
            />
            <datalist id="pictor-known-tools">
              {KNOWN_TOOLS.map((name) => (
                <option key={name} value={name} />
              ))}
              <option value="*" />
            </datalist>
            <Input
              aria-label="匹配模式"
              value={pattern}
              placeholder="例如 npm publish*"
              onChange={(event) => setPattern(event.target.value)}
              className="h-8 min-w-48 flex-1 text-xs"
            />
            <Button size="sm" disabled={busy || tool.trim().length === 0} onClick={add}>
              <Plus className="size-3.5" />
              添加
            </Button>
          </div>
        }
      />

      {error !== null && (
        <div className="px-4 py-3 text-2xs text-danger" role="alert">
          {error}
        </div>
      )}
    </Section>
  )
}
