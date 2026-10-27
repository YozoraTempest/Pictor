import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { ToolRule, ToolRuleEffect } from '@vulonlok/shared'

import { Badge, Button, Input } from '@vulonlok/ui'
import { cn } from '@vulonlok/ui/cn'
import { Section } from './Section.js'
import { SettingRow } from './SettingRow.js'

/** Tools worth offering as a hint; the field stays free text for the rest. */
const KNOWN_TOOLS = ['bash', 'write', 'edit', 'read', 'web_fetch', 'web_search', 'subagent']

/** The three verdicts, in the order the policy ranks them when two overlap. */
const EFFECTS: {
  id: ToolRuleEffect
  label: string
  badge: 'danger' | 'accent' | 'neutral'
  selected: string
}[] = [
  { id: 'deny', label: '拒绝', badge: 'danger', selected: 'bg-danger/15 text-danger' },
  { id: 'ask', label: '询问', badge: 'accent', selected: 'bg-accent/15 text-accent' },
  { id: 'allow', label: '允许', badge: 'neutral', selected: 'bg-surface-hover text-text' },
]

function describe(rule: ToolRule): string {
  const scope = rule.tool === '*' ? '所有工具' : rule.tool
  return rule.pattern.length === 0 ? scope : `${scope}(${rule.pattern})`
}

/**
 * What one rule does, in the rule's own terms.
 *
 * The halves are not symmetric, and the page says so. Denying and asking both see
 * the real arguments, so their patterns are exact. Allowing cannot: dsh's escalation
 * prompt carries only the tool name, so an allow answers that prompt for the whole
 * tool. And asking only means something where the kernel can pause a call — Pi can,
 * dsh decides for itself — which the copy names rather than implying.
 */
function meaningOf(rule: ToolRule): string {
  if (rule.effect === 'deny') return '匹配到这次调用的参数就拒绝，不会执行'
  if (rule.effect === 'ask') return '匹配到就先暂停，等你批准；在能暂停调用的内核（Pi）上生效'
  return '该工具的升权确认自动同意；参数不参与匹配'
}

/**
 * Per-tool policy: what the agent may never do, what must wait for a person, and
 * what it need not ask about.
 *
 * Two rows about the same tool are not ambiguous: the stricter one wins — deny, then
 * ask, then allow — so a reader can add an exception without having to delete what it
 * excepts.
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

  const count = (wanted: ToolRuleEffect): number =>
    (rules ?? []).filter((rule) => rule.effect === wanted).length

  return (
    <Section
      title="工具规则"
      description="按工具限制 agent 能做什么。拒绝直接拦下这次调用；询问在有对应能力的内核上先暂停等你批准（Pi）；允许只用于替你回答该工具的升权确认。同一个工具的规则冲突时，拒绝优先于询问，询问优先于允许。"
      actions={
        <Badge tone="neutral">
          {count('deny')} 拒绝 / {count('ask')} 询问 / {count('allow')} 允许
        </Badge>
      }
      padded={false}
    >
      {(rules ?? []).map((rule) => {
        const known = EFFECTS.find((entry) => entry.id === rule.effect)
        return (
          <SettingRow
            key={rule.id}
            title={describe(rule)}
            description={meaningOf(rule)}
            control={
              <div className="flex items-center gap-2">
                <Badge tone={known?.badge ?? 'neutral'}>{known?.label ?? rule.effect}</Badge>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`删除规则 ${describe(rule)}`}
                  disabled={busy}
                  onClick={() =>
                    void persist((rules ?? []).filter((entry) => entry.id !== rule.id))
                  }
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            }
          />
        )
      })}

      {rules !== null && rules.length === 0 && (
        <SettingRow
          title="还没有规则"
          description="例如拒绝 bash(npm publish*)：模型想发布包时会被直接拦下。或者询问 bash(rm *)：每次删除前先停下来问你。"
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
              {EFFECTS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  aria-pressed={effect === entry.id}
                  onClick={() => setEffect(entry.id)}
                  className={cn(
                    'px-2.5 py-1.5 text-2xs transition-colors duration-150',
                    effect === entry.id ? entry.selected : 'text-muted hover:bg-surface-hover',
                  )}
                >
                  {entry.label}
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
