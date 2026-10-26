import { Plus, Server, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { McpServerSpec } from '@pictor/shared'
import { isMcpServerName } from '@pictor/shared'

import {
  Badge,
  Banner,
  Button,
  Dialog,
  Field,
  Input,
  Spinner,
  Switch,
} from '../../components/ui/index.js'
import { Section } from './Section.js'
import { SettingRow } from './SettingRow.js'

/**
 * What the agent can reach outside this app.
 *
 * One list for both kernels, because a person configures a capability, not a runtime:
 * dsh mounts each server from its profile patch (so a change restarts the runtime),
 * Pi gets the same list written into `mcp.json` inside Pictor's isolated config (so it
 * takes effect on the next conversation). Where a kernel cannot take the list, the page
 * says which and why rather than drawing a switch that does nothing.
 */
export function McpSection(): React.JSX.Element {
  const [servers, setServers] = useState<McpServerSpec[] | null>(null)
  const [editing, setEditing] = useState<McpServerSpec | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void window.pictor
      .mcpServers()
      .then((next) => {
        if (alive) setServers(next)
      })
      .catch((reason: unknown) => {
        if (!alive) return
        setError(reason instanceof Error ? reason.message : String(reason))
        setServers([])
      })
    return () => {
      alive = false
    }
  }, [])

  async function save(next: McpServerSpec[]): Promise<void> {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const saved = await window.pictor.saveMcpServers(next)
      setServers(saved)
      setEditing(null)
      setNotice(
        saved.some((server) => server.enabled)
          ? '已保存：DSH 会重启以挂载服务器；Pi 在下一个会话开始时读取'
          : '已保存',
      )
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  async function toggle(server: McpServerSpec, enabled: boolean): Promise<void> {
    const current = servers ?? []
    setServers(current.map((entry) => (entry.name === server.name ? { ...entry, enabled } : entry)))
    await save(current.map((entry) => (entry.name === server.name ? { ...entry, enabled } : entry)))
  }

  async function remove(server: McpServerSpec): Promise<void> {
    await save((servers ?? []).filter((entry) => entry.name !== server.name))
  }

  const list = servers ?? []

  return (
    <Section
      title="MCP 服务器"
      description="让 agent 用上外部的工具：数据库、浏览器、内部接口。列表对两个内核都生效。"
      actions={
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || servers === null}
          onClick={() => setEditing(blankServer())}
        >
          <Plus className="size-3.5" />
          添加服务器
        </Button>
      }
      padded={false}
    >
      {error !== null && (
        <div className="px-4 pt-3">
          <Banner tone="error">{error}</Banner>
        </div>
      )}
      {notice !== null && (
        <div className="px-4 pt-3">
          <Banner tone="notice">{notice}</Banner>
        </div>
      )}

      {servers === null && (
        <div className="flex items-center gap-2 px-4 py-4 text-2xs text-faint">
          <Spinner className="size-3.5" />
          读取中
        </div>
      )}

      {servers !== null && list.length === 0 && (
        <p className="px-4 py-4 text-2xs leading-relaxed text-faint">
          还没有配置服务器。添加一个 stdio 服务器（一个命令，例如 npx）或一个 HTTP
          服务器（一个地址）。
        </p>
      )}

      {list.map((server) => (
        <div
          key={server.name}
          className="flex flex-wrap items-start justify-between gap-3 border-t border-border px-4 py-3 first:border-t-0"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Server className="size-3.5 shrink-0 text-faint" aria-hidden />
              <span className="truncate font-mono text-xs text-text">{server.name}</span>
              <Badge tone="neutral">{server.transport === 'http' ? 'HTTP' : 'stdio'}</Badge>
            </div>
            <p className="mt-1 break-all font-mono text-2xs text-faint">
              {server.transport === 'http'
                ? server.url
                : [server.command, ...server.args].join(' ')}
            </p>
            <p className="mt-1 text-2xs text-faint">{whereItApplies(server)}</p>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Switch
              label={`启用 ${server.name}`}
              checked={server.enabled}
              disabled={busy}
              onChange={(next) => void toggle(server, next)}
            />
            <Button
              variant="ghost"
              size="sm"
              aria-label={`删除 ${server.name}`}
              disabled={busy}
              onClick={() => void remove(server)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>
      ))}

      <SettingRow
        title="什么时候生效"
        description="DSH 从 profile 补丁挂载服务器，改动需要重启运行时（有回合在跑时会等到它结束）。Pi 在每次起会话时读 mcp.json。"
        control={null}
      />
      <SettingRow
        title="Pi 用自己的配置时"
        description="打开「使用我自己的 Pi 配置」后，Pi 读的是 ~/.pi/agent/mcp.json；这份列表只作用于 DSH。"
        control={null}
      />

      {editing !== null && (
        <ServerDialog
          server={editing}
          taken={list.map((server) => server.name)}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={(server) => {
            const others = list.filter((entry) => entry.name !== server.name)
            void save([...others, server].sort((a, b) => a.name.localeCompare(b.name)))
          }}
        />
      )}
    </Section>
  )
}

/** What the list does for one server, in this kernel's terms. */
function whereItApplies(server: McpServerSpec): string {
  if (!server.enabled) return '已停用：两个内核都不会加载'
  const target = server.transport === 'http' ? server.url : server.command
  return `工具会以 mcp__${server.name}__* 出现在对话里（${target}）`
}

function blankServer(): McpServerSpec {
  return {
    name: '',
    transport: 'stdio',
    command: '',
    args: [],
    env: {},
    url: '',
    headers: {},
    enabled: true,
  }
}

/** One server, edited as text: values people type are lines, not JSON. */
function ServerDialog({
  server,
  taken,
  busy,
  onClose,
  onSave,
}: {
  server: McpServerSpec
  taken: readonly string[]
  busy: boolean
  onClose: () => void
  onSave: (server: McpServerSpec) => void
}): React.JSX.Element {
  const [name, setName] = useState(server.name)
  const [transport, setTransport] = useState<McpServerSpec['transport']>(server.transport)
  const [command, setCommand] = useState(server.command)
  const [args, setArgs] = useState(server.args.join('\n'))
  const [url, setUrl] = useState(server.url)
  const [pairs, setPairs] = useState(lines(transport === 'http' ? server.headers : server.env))

  const trimmed = name.trim()
  const problem =
    trimmed.length === 0
      ? '要给这个服务器一个名字'
      : !isMcpServerName(trimmed)
        ? '名字只能用字母、数字、下划线和连字符，最多 32 个字符'
        : taken.includes(trimmed) && trimmed !== server.name
          ? '这个名字已经被另一个服务器用了'
          : transport === 'stdio' && command.trim().length === 0
            ? 'stdio 服务器需要一个命令'
            : transport === 'http' && url.trim().length === 0
              ? 'HTTP 服务器需要一个地址'
              : null

  return (
    <Dialog
      open
      title={server.name.length === 0 ? '添加 MCP 服务器' : `编辑 ${server.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={busy || problem !== null}
            onClick={() =>
              onSave({
                name: trimmed,
                transport,
                command: transport === 'stdio' ? command.trim() : '',
                args:
                  transport === 'stdio'
                    ? args
                        .split('\n')
                        .map((line) => line.trim())
                        .filter((line) => line.length > 0)
                    : [],
                env: transport === 'stdio' ? keyValues(pairs) : {},
                url: transport === 'http' ? url.trim() : '',
                headers: transport === 'http' ? keyValues(pairs) : {},
                enabled: server.enabled,
              })
            }
          >
            保存
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="名字" hint={problem ?? '工具会以 mcp__<名字>__<工具> 出现在对话里'}>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="files"
          />
        </Field>

        <Field label="类型">
          <div className="flex gap-1">
            {(['stdio', 'http'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setTransport(option)}
                className={
                  option === transport
                    ? 'rounded-md bg-accent/15 px-2.5 py-1 text-xs text-accent'
                    : 'rounded-md px-2.5 py-1 text-xs text-muted hover:bg-surface-hover'
                }
              >
                {option === 'stdio' ? 'stdio：跑一个命令' : 'HTTP：连一个地址'}
              </button>
            ))}
          </div>
        </Field>

        {transport === 'stdio' ? (
          <>
            <Field label="命令" hint="一个可执行文件，不是一整行 shell">
              <Input
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                placeholder="npx"
              />
            </Field>
            <Field label="参数" hint="每行一个，会原样传给命令">
              <Textarea
                value={args}
                onChange={setArgs}
                placeholder={'-y\n@modelcontextprotocol/server-filesystem\n.'}
              />
            </Field>
          </>
        ) : (
          <Field label="地址" hint="streamable HTTP 的端点">
            <Input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/mcp"
            />
          </Field>
        )}

        <Field
          label={transport === 'http' ? '请求头' : '环境变量'}
          hint="每行一个 KEY=VALUE；需要令牌的服务器通常放在这里"
        >
          <Textarea value={pairs} onChange={setPairs} placeholder="API_KEY=..." />
        </Field>
      </div>
    </Dialog>
  )
}

function lines(map: Record<string, string>): string {
  return Object.entries(map)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
}

function keyValues(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const at = line.indexOf('=')
    if (at <= 0) continue
    const key = line.slice(0, at).trim()
    const value = line.slice(at + 1).trim()
    if (key.length === 0) continue
    out[key] = value
  }
  return out
}

function Textarea({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}): React.JSX.Element {
  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      rows={3}
      spellCheck={false}
      className="w-full resize-y rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-2xs leading-relaxed text-text outline-none focus:border-border-strong focus:ring-1 focus:ring-accent/20"
    />
  )
}
