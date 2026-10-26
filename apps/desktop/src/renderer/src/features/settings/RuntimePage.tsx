import { Download, Play, RefreshCw, Square } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import type { HarnessStatus } from '../../../../shared/bridge.js'
import { versionStateOf } from '../../../../main/runtime-version.js'
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

/** Where this kernel comes from, for the one row that says how to get it. */
const PI_INSTALL = 'npm i -g @earendil-works/pi-coding-agent'

/**
 * One kernel's runtime page.
 *
 * The two kernels are shaped differently, so they get their own pages rather than
 * one page drawing the same rows twice: dsh is a server this app boots and keeps,
 * Pi is a CLI spawned per conversation. "Start" only means something for the first,
 * and a button for the second would be a control that does nothing — which is why
 * this component takes the kernel instead of rendering both.
 */
export interface RuntimePageProps {
  kernel: 'dsh' | 'pi'
}

/**
 * The kernels that run conversations.
 *
 * Pictor has no agent loop of its own, and it no longer has one runtime either:
 * this page shows every kernel the build can drive, what state each is in, which
 * version is on the machine, and the actions that make sense for how it runs.
 */
export function RuntimePage({ kernel }: RuntimePageProps): React.JSX.Element {
  const projects = useWorkspaceStore((state) => state.projects)
  const selectedProjectId = useWorkspaceStore((state) => state.selectedProjectId)
  const project = projects.find((entry) => entry.id === selectedProjectId) ?? null

  const [statuses, setStatuses] = useState<Record<string, HarnessStatus> | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The install runs npm for minutes; its own last line is the only honest sign of
  // life the page can show while the button spins.
  const [installLine, setInstallLine] = useState<string | null>(null)

  const read = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      setStatuses(await window.pictor.kernelStatuses())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [])

  useEffect(() => {
    void read()
  }, [read])

  useEffect(() => window.pictor.onHarnessInstall(setInstallLine), [])

  async function act(id: string, action: () => Promise<HarnessStatus>): Promise<void> {
    setBusy(id)
    setError(null)
    try {
      await action()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(null)
      setInstallLine(null)
      await read()
    }
  }

  const dsh = statuses?.['dsh'] ?? null
  const ready = dsh?.state === 'ready'
  const version = dsh === null ? 'unknown' : versionStateOf(dsh.expectedVersion, dsh.version)

  return (
    <div className="flex flex-col gap-6">
      {error !== null && <Banner tone="error">{error}</Banner>}
      {busy !== null && installLine !== null && (
        <Banner tone="notice">
          <span className="font-mono text-2xs">{installLine}</span>
        </Banner>
      )}

      {/* dsh: the server this app boots, so it owns the start/stop pair. */}
      {kernel === 'dsh' && (
        <Section
          title="进程"
          description="常驻服务：由 Pictor 启动并保持运行，会话消息都经过它。"
          actions={
            <>
              {dsh !== null && dsh.binary === null && (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void act('dsh', () => window.pictor.installHarness())}
                >
                  {busy === 'dsh' ? (
                    <Spinner className="size-3.5" />
                  ) : (
                    <Download className="size-3.5" />
                  )}
                  安装
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                disabled={busy !== null || ready || dsh?.binary === null || dsh === null}
                onClick={() =>
                  void act('dsh', () => window.pictor.harnessStart(project?.path ?? ''))
                }
              >
                {busy === 'dsh' ? <Spinner className="size-3.5" /> : <Play className="size-3.5" />}
                启动
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy !== null || !ready}
                onClick={() => void act('dsh', () => window.pictor.harnessStop())}
              >
                <Square className="size-3.5" />
                停止
              </Button>
            </>
          }
          padded={false}
        >
          {dsh !== null && dsh.binary === null && (
            <div className="px-5 py-3">
              <Banner tone="notice">
                还没有安装。安装到本机配置目录后即可使用；安装需要联网，几百兆。也可以设置
                PICTOR_DSH_BIN 指向已有的 dsh 启动器。
              </Banner>
            </div>
          )}
          {dsh !== null && dsh.error !== null && dsh.binary !== null && (
            <div className="px-5 py-3">
              <Banner tone="error">{dsh.error}</Banner>
            </div>
          )}

          <SettingRow
            title="状态"
            description="运行中就绪后才接收会话消息。"
            control={
              <Badge tone={dsh === null ? 'neutral' : STATE_TONE[dsh.state]}>
                {dsh === null ? '读取中' : STATE_LABEL[dsh.state]}
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
                <span className="font-mono text-2xs text-muted">{dsh?.version ?? '未安装'}</span>
                {version === 'mismatch' && (
                  <>
                    <span className="text-2xs text-faint">期望 {dsh?.expectedVersion ?? '?'}</span>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => void act('dsh', () => window.pictor.installHarness())}
                    >
                      {busy === 'dsh' ? (
                        <Spinner className="size-3.5" />
                      ) : (
                        <Download className="size-3.5" />
                      )}
                      重新安装
                    </Button>
                  </>
                )}
                {version === 'match' && <Badge tone="success">与内置一致</Badge>}
              </div>
            }
          />
          <SettingRow
            title="会话数据"
            description="这个内核的会话记录与运行时资料放在这里。"
            control={
              <span className="block max-w-72 truncate font-mono text-2xs text-muted">
                {dsh?.home ?? '—'}
              </span>
            }
          />
        </Section>
      )}

      {/* Pi: a CLI on the machine, started per conversation, so only the facts. */}
      {kernel === 'pi' && (
        <Section
          title="安装"
          description="按会话启动，不常驻：每个会话在第一次发言时起一个子进程，结束就退出。"
          actions={
            <Button
              variant="ghost"
              size="sm"
              disabled={busy !== null}
              onClick={() =>
                void act('pi', async () => {
                  const every = await window.pictor.kernelStatuses()
                  const status = every['pi']
                  // The page only renders a kernel the build lists, so this cannot be
                  // missing; answering with it keeps `act` a single shape.
                  if (status === undefined) throw new Error('这个版本不认识 pi 内核')
                  return status
                })
              }
            >
              {busy === 'pi' ? (
                <Spinner className="size-3.5" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              重新检测
            </Button>
          }
          padded={false}
        >
          <SettingRow
            title="状态"
            description="在 PATH 上找到可执行文件即可用；会话结束后进程退出，所以这里不显示「运行中」。"
            control={
              <Badge tone={statuses?.['pi']?.binary == null ? 'neutral' : 'success'}>
                {statuses === null
                  ? '读取中'
                  : statuses['pi']?.binary == null
                    ? '未安装'
                    : '已安装'}
              </Badge>
            }
          />
          <SettingRow
            title="版本"
            description="这一版 Pictor 不锁定 Pi 的版本；它自己发布，也自己决定兼容的模型。"
            control={
              <span className="font-mono text-2xs text-muted">
                {statuses?.['pi']?.version ?? '未安装'}
              </span>
            }
          />
          <SettingRow
            title="可执行文件"
            description="找不到时可以让 PICTOR_PI_BIN 直接指向 pi 的入口文件。"
            control={
              <span className="block max-w-72 truncate font-mono text-2xs text-muted">
                {statuses?.['pi']?.binary ?? '未找到'}
              </span>
            }
          />
          <SettingRow
            title="会话数据"
            description="Pi 自己写会话文件，Pictor 只是读回来当历史。"
            control={
              <span className="block max-w-72 truncate font-mono text-2xs text-muted">
                {statuses?.['pi']?.home ?? '—'}
              </span>
            }
          />
          {statuses?.['pi']?.binary == null && (
            <SettingRow
              title="安装"
              description="Pictor 不会替你在全局装包；装好后回到这里点「重新检测」。"
              control={
                <code className="selectable rounded-md bg-bg px-2 py-1 font-mono text-2xs text-muted">
                  {PI_INSTALL}
                </code>
              }
            />
          )}
        </Section>
      )}
    </div>
  )
}
