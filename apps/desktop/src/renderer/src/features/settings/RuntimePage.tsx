import { Download, Play, Square } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { HarnessStatus } from '../../../../shared/bridge.js'
import { useWorkspaceStore } from '../../app/workspace-store.js'
import { versionStateOf } from '../../../../main/runtime-version.js'
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
      title="内核"
      description="Pictor 不自己跑 agent：会话由这个进程执行。这里启动、停止它，并核对版本。"
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
              安装内核
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
            还没有内核。安装到本机配置目录后即可使用；安装需要联网，几百兆。也可以 设置
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
            ? '本机内核与这一版 Pictor 内置的不是同一版；重装会改写它。'
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
    </Section>
  )
}
