import { useEffect, useState } from 'react'

import type { HarnessStatus, PermissionMode } from '../../../../shared/bridge.js'
import { cn } from '../../lib/cn.js'
import { Section } from './Section.js'
import { SettingRow } from './SettingRow.js'

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

/**
 * The sandbox default for conversations dsh creates from now on.
 *
 * It sits in the kernel's own group rather than in the shell's: the runtime owns
 * this value and applies it live, and a kernel without a sandbox has nothing to set
 * here. A conversation that already exists keeps its own mode — the composer's
 * picker is where that one is changed.
 */
export function DefaultPermissionSection(): React.JSX.Element {
  const [status, setStatus] = useState<HarnessStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.pictor
      .harnessStatus()
      .then(setStatus)
      .catch((reason: unknown) => setError(String(reason)))
  }, [])

  useEffect(
    () =>
      window.pictor.onHarnessStatus((next) => {
        setStatus(next)
      }),
    [],
  )

  const ready = status?.state === 'ready'

  async function choose(mode: PermissionMode): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      setStatus(await window.pictor.setHarnessPermissionMode(mode))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section
      title="默认权限模式"
      description="新会话以这个模式开始；已经打开的会话各自保持自己的模式，可在输入框左下角单独调整。"
    >
      <SettingRow
        stacked
        title="沙箱范围"
        description={
          ready
            ? '决定内核能以多大范围改动文件系统，以及是否需要逐次审批。改动立即生效，不用重启。'
            : '决定内核能以多大范围改动文件系统，以及是否需要逐次审批。运行时启动后生效。'
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
                  onClick={() => void choose(mode.id)}
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

      {error !== null && (
        <p className="text-2xs text-danger" role="alert">
          {error}
        </p>
      )}
    </Section>
  )
}
