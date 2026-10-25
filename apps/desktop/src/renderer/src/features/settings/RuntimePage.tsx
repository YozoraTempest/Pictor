import { Download, Play, Square } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { HarnessStatus, PermissionMode } from '../../../../shared/bridge.js'
import { useWorkspaceStore } from '../../app/workspace-store.js'
import { versionStateOf } from '../../../../main/runtime-version.js'
import { Badge, Banner, Button, Spinner } from '../../components/ui/index.js'
import { cn } from '../../lib/cn.js'
import { Section } from './Section.js'
import { SettingRow } from './SettingRow.js'

const STATE_LABEL: Record<HarnessStatus['state'], string> = {
  stopped: '未启动',
  starting: '启动中',
  ready: '运行中',
  error: '异常',
}

const MODES: Array<{ id: PermissionMode; label: string; description: string }> = [
  {
    id: 'read-only',
    label: '只读',
    description: '可以读文件与检索，不能写文件、不能起进程。适合先看清再动手。',
  },
  {
    id: 'workspace-write',
    label: '工作区可写',
    description: '写入限制在当前项目目录内，越界操作需要审批。日常默认。',
  },
  {
    id: 'danger-full-access',
    label: '完全访问',
    description: '不限制写入范围，同时关闭逐次审批。只在确认任务可信时使用。',
  },
]

const STATE_TONE: Record<HarnessStatus['state'], 'success' | 'neutral' | 'danger'> = {
  stopped: 'neutral',
  starting: 'neutral',
  ready: 'success',
  error: 'danger',
}

/**
 * The agent runtime that actually runs conversations.
 *
 * Pictor has no agent loop of its own: this page shows the process the main
 * process boots, which service and model it will use, and lets the runtime be
 * started or stopped without restarting the window.
 */
export function RuntimePage(): React.JSX.Element {
  const projects = useWorkspaceStore((state) => state.projects)
  const selectedProjectId = useWorkspaceStore((state) => state.selectedProjectId)
  const project = projects.find((entry) => entry.id === selectedProjectId) ?? null

  const [status, setStatus] = useState<HarnessStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.pictor
      .harnessStatus()
      .then(setStatus)
      .catch((reason: unknown) => setError(String(reason)))
  }, [])

  async function run(action: () => Promise<HarnessStatus>): Promise<void> {
    setBusy(true)
    setError(null)
    setInstallLine(null)
    try {
      setStatus(await action())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
      setInstallLine(null)
    }
  }

  // The install runs npm for minutes; its own last line is the only honest sign
  // of life the page can show while the button spins.
  const [installLine, setInstallLine] = useState<string | null>(null)

  useEffect(() => window.pictor.onHarnessInstall(setInstallLine), [])

  const ready = status?.state === 'ready'
  const version =
    status === null ? 'unknown' : versionStateOf(status.expectedVersion, status.version)

  return (
    <Section
      title="运行时"
      description="会话由独立的 agent 运行时进程执行；这里启动、停止并核对它用的服务。"
      actions={
        <>
          {status !== null && status.binary === null && (
            <Button
              variant="primary"
              size="sm"
              disabled={busy}
              onClick={() => void run(() => window.pictor.installHarness())}
            >
              {busy ? <Spinner className="size-3.5" /> : <Download className="size-3.5" />}
              安装运行时
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || ready || status?.binary === null || status === null}
            onClick={() => void run(() => window.pictor.harnessStart(project?.path ?? ''))}
          >
            {busy ? <Spinner className="size-3.5" /> : <Play className="size-3.5" />}
            启动
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || !ready}
            onClick={() => void run(() => window.pictor.harnessStop())}
          >
            <Square className="size-3.5" />
            停止
          </Button>
        </>
      }
      padded={false}
    >
      {error !== null && (
        <div className="px-5 py-3">
          <Banner tone="error">{error}</Banner>
        </div>
      )}
      {busy && installLine !== null && (
        <div className="px-5 py-3">
          <Banner tone="notice">
            <span className="font-mono text-2xs">{installLine}</span>
          </Banner>
        </div>
      )}
      {status !== null && status.binary === null && (
        <div className="px-5 py-3">
          <Banner tone="notice">
            还没有运行时。安装到本机配置目录后即可使用；安装需要联网，几百兆。也可以 设置
            PICTOR_DSH_BIN 指向已有的 dsh 启动器。
          </Banner>
        </div>
      )}
      {status !== null && status.error !== null && status.binary !== null && (
        <div className="px-5 py-3">
          <Banner tone="error">{status.error}</Banner>
        </div>
      )}

      <SettingRow
        title="状态"
        description="运行中就绪后才接收会话消息。"
        control={
          <Badge tone={status === null ? 'neutral' : STATE_TONE[status.state]}>
            {status === null ? '读取中' : STATE_LABEL[status.state]}
          </Badge>
        }
      />

      <SettingRow
        title="版本"
        description={
          version === 'mismatch'
            ? '本机的运行时与这一版 Pictor 内置的不是同一版；重装会改写它。'
            : '内置的那一版，安装时按它拉取。'
        }
        control={
          <div className="flex items-center gap-2">
            <span className="font-mono text-2xs text-muted">{status?.version ?? '未安装'}</span>
            {version === 'mismatch' && (
              <>
                <span className="text-2xs text-faint">期望 {status?.expectedVersion ?? '?'}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => void run(() => window.pictor.installHarness())}
                >
                  {busy ? <Spinner className="size-3.5" /> : <Download className="size-3.5" />}
                  重新安装
                </Button>
              </>
            )}
            {version === 'match' && <Badge tone="success">与内置一致</Badge>}
          </div>
        }
      />

      <SettingRow
        stacked
        title="默认权限模式"
        description={
          ready
            ? '决定内核能以多大范围改动文件系统，以及是否需要逐次审批。改动立即生效，不用重启。'
            : '决定内核能以多大范围改动文件系统，以及是否需要逐次审批。runtime 启动后生效。'
        }
        control={
          <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="权限模式">
            {MODES.map((mode) => {
              const active = (status?.permissionMode ?? 'workspace-write') === mode.id

              return (
                <button
                  key={mode.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={busy}
                  onClick={() => void run(() => window.pictor.setHarnessPermissionMode(mode.id))}
                  className={cn(
                    'rounded-md border px-2.5 py-2 text-left transition-colors duration-150',
                    active
                      ? 'border-border-strong bg-surface-hover'
                      : 'border-border hover:bg-surface-hover',
                  )}
                >
                  <span className="flex items-center gap-2 text-xs text-text">
                    <span
                      className={cn(
                        'grid size-3.5 shrink-0 place-items-center rounded-full border',
                        active ? 'border-accent' : 'border-border-strong',
                      )}
                    >
                      {active && <span className="size-1.5 rounded-full bg-accent" />}
                    </span>
                    {mode.label}
                  </span>
                  <span className="mt-1 block text-2xs leading-relaxed text-faint">
                    {mode.description}
                  </span>
                </button>
              )
            })}
          </div>
        }
      />

      <SettingRow
        stacked
        title="启动器"
        description="内核可替换：换一个启动器就是换一个 agent 运行时。"
        control={
          <span className="block max-w-[22rem] truncate font-mono text-2xs text-faint">
            {status?.binary ?? '—'}
          </span>
        }
      />

      <SettingRow
        stacked
        title="运行目录"
        description="会话日志、存储与 profile 都在这个目录下。"
        control={
          <span className="block max-w-[22rem] truncate font-mono text-2xs text-faint">
            {status?.home ?? '—'}
          </span>
        }
      />

      <SettingRow
        title="路由与模型"
        description="取自「智能体 › 模型」里使用中的服务。"
        control={
          <span className="font-mono text-2xs text-faint">
            {status?.provider ?? '—'}
            {status?.model === null || status?.model === undefined ? '' : ` · ${status.model}`}
          </span>
        }
      />

      <SettingRow
        stacked
        title="工作目录"
        description="取自当前选中的项目；没有项目时用主目录。"
        control={
          <span className="block max-w-[22rem] truncate font-mono text-2xs text-faint">
            {project?.path ?? '主目录'}
          </span>
        }
      />
    </Section>
  )
}
