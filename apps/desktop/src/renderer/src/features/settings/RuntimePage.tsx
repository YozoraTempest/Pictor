import { Play, Square } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { HarnessStatus } from '../../../../shared/bridge.js'
import { useWorkspaceStore } from '../../app/workspace-store.js'
import { Badge, Banner, Button, Spinner } from '../../components/ui/index.js'
import { Section } from './Section.js'
import { SettingRow } from './SettingRow.js'

const STATE_LABEL: Record<HarnessStatus['state'], string> = {
  stopped: '未启动',
  starting: '启动中',
  ready: '运行中',
  error: '异常',
}

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
    try {
      setStatus(await action())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const ready = status?.state === 'ready'

  return (
    <Section
      title="运行时"
      description="会话由独立的 agent 运行时进程执行；这里启动、停止并核对它用的服务。"
      actions={
        <>
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
      {status !== null && status.binary === null && (
        <div className="px-5 py-3">
          <Banner tone="notice">
            没有找到运行时。安装 `@deepseek-ai/dsh`，或用环境变量 PICTOR_DSH_BIN 指向它的启动器。
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
        title="启动器"
        description="内核可替换：换一个启动器就是换一个 agent 运行时。"
        control={
          <span className="block max-w-[22rem] truncate font-mono text-2xs text-faint">
            {status?.binary ?? '—'}
          </span>
        }
      />

      <SettingRow
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
