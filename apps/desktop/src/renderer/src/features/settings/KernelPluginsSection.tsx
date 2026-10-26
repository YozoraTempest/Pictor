import { useEffect, useState } from 'react'

import type { KernelPluginInfo } from '../../../../shared/bridge.js'
import { Button } from '../../components/ui/Button.js'
import { Dialog } from '../../components/ui/Dialog.js'
import { Input } from '../../components/ui/Input.js'
import { cn } from '../../lib/cn.js'
import { Section } from './Section.js'

/**
 * What host services a kernel can reach, in words a person can judge.
 *
 * A kernel cannot run a turn without the model service, so that one is the real
 * trust decision; the rest is context it would otherwise guess.
 */
const SERVICE_LABELS: Record<string, string> = {
  'pictor.models': '模型服务（含密钥）',
  'pictor.rules': '工具规则',
  'pictor.guard': '工具守卫端点',
  'pictor.permission': '默认权限模式',
  'pictor.workspace': '会话工作目录',
  'pictor.userdata': '数据目录',
}

function serviceLabel(name: string): string {
  return SERVICE_LABELS[name] ?? name
}

/** What the window is about to do, once the person has confirmed it. */
type Pending =
  | { kind: 'folder' }
  | { kind: 'package'; spec: string }
  | { kind: 'remove'; id: string; label: string }

/**
 * The kernels this app will run, including the ones it does not know about.
 *
 * Two of them are compiled in and the rest are installed, but the page does not
 * distinguish beyond saying where each came from: what matters is that a third-party
 * kernel is listed with the services it declared, so trusting one is a decision made
 * with the facts in front of you. Installing asks the same question before it copies
 * anything, because a kernel can read the model service — and the key in it.
 */
export function KernelPluginsSection(): React.JSX.Element {
  const [plugins, setPlugins] = useState<KernelPluginInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [home, setHome] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  async function load(): Promise<void> {
    try {
      setPlugins(await window.pictor.listKernelPlugins())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  useEffect(() => {
    void load()
    // The database lives in the same directory as the kernels folder; naming the
    // folder without asking the app for a second path keeps them from disagreeing.
    void window.pictor
      .getAppInfo()
      .then((info) => {
        const index = Math.max(info.database.lastIndexOf('/'), info.database.lastIndexOf('\\'))
        setHome(index > 0 ? info.database.slice(0, index) : null)
      })
      .catch(() => undefined)
  }, [])

  async function submit(): Promise<void> {
    if (pending === null) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      if (pending.kind === 'remove') {
        const result = await window.pictor.removeKernel(pending.id)
        setNotice(result.ok ? `已卸载 ${pending.label}` : result.message)
      } else if (pending.kind === 'folder') {
        const path = await window.pictor.chooseKernelFolder()
        if (path === null) return
        const result = await window.pictor.installKernelFolder(path)
        setNotice(result.ok ? `已安装 ${result.id ?? ''}` : result.message)
      } else {
        const result = await window.pictor.installKernelPackage(pending.spec.trim())
        setNotice(result.ok ? `已安装 ${result.id ?? ''}` : result.message)
      }
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
      setPending(null)
    }
  }

  const broken = (plugins ?? []).filter((entry) => entry.failure !== null)

  return (
    <Section
      title="内核插件"
      description="会话由内核执行。装一个内核不必重启，装完就能在首页选到它。"
      actions={
        <>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setPending({ kind: 'folder' })
            }}
          >
            从目录安装
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setPending({ kind: 'package', spec: '' })
            }}
          >
            从 npm 安装
          </Button>
        </>
      }
    >
      {plugins === null && error === null && <p className="text-xs text-faint">读取中…</p>}

      {plugins !== null && (
        <ul className="flex flex-col gap-2" aria-label="已挂载的内核">
          {plugins.map((plugin) => (
            <li
              key={`${plugin.source}/${plugin.id}`}
              className={cn(
                'rounded-md border px-3 py-2.5',
                plugin.failure === null ? 'border-border' : 'border-danger/40 bg-danger/5',
              )}
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-xs text-text">{plugin.label}</span>
                <span className="font-mono text-2xs text-faint">{plugin.id}</span>
                {plugin.failure === null ? (
                  <span className="ml-auto text-2xs text-faint">
                    {plugin.available ? '可用' : '未安装'}
                  </span>
                ) : (
                  <span className="ml-auto text-2xs text-danger">未挂载</span>
                )}
              </div>

              <p className="mt-1 text-2xs text-faint">
                {plugin.source === 'builtin' ? '随应用编译' : `已安装：${plugin.source}`}
              </p>

              {plugin.failure !== null && (
                <p className="mt-1.5 text-2xs leading-relaxed text-danger" role="alert">
                  {plugin.failure}
                </p>
              )}

              {plugin.failure === null && (
                <p className="mt-1.5 text-2xs leading-relaxed text-muted">
                  {plugin.services.length === 0
                    ? '不读取任何宿主服务'
                    : `可以读取：${plugin.services.map(serviceLabel).join('、')}`}
                </p>
              )}

              {plugin.source !== 'builtin' && (
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    className="rounded-sm px-1.5 py-0.5 text-2xs text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-danger"
                    onClick={() => {
                      setPending({ kind: 'remove', id: plugin.id, label: plugin.label })
                    }}
                  >
                    卸载
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {broken.length > 0 && (
        <p className="text-2xs leading-relaxed text-faint">
          未挂载的内核不会出现在首页的内核选择里；修好它的目录再重启即可，其余内核不受影响。
        </p>
      )}

      <p className="text-2xs leading-relaxed text-faint">
        {home === null
          ? '内核装在应用数据目录下的 kernels/ 里。'
          : `内核装在 ${home}/kernels/ 里：目录安装会整份复制，包安装由 npm 装进它的 node_modules。`}
      </p>

      {notice !== null && <p className="text-2xs leading-relaxed text-muted">{notice}</p>}

      {error !== null && (
        <p className="text-2xs text-danger" role="alert">
          {error}
        </p>
      )}

      <Dialog
        open={pending !== null}
        title={
          pending?.kind === 'remove'
            ? `卸载 ${pending.label}？`
            : pending?.kind === 'package'
              ? '从 npm 安装内核'
              : '从目录安装内核'
        }
        onClose={() => {
          if (!busy) setPending(null)
        }}
        footer={
          <>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setPending(null)
              }}
            >
              取消
            </Button>
            <Button
              size="sm"
              variant={pending?.kind === 'remove' ? 'danger' : 'primary'}
              disabled={busy || (pending?.kind === 'package' && pending.spec.trim().length === 0)}
              onClick={() => void submit()}
            >
              {busy ? '处理中…' : pending?.kind === 'remove' ? '卸载' : '安装'}
            </Button>
          </>
        }
      >
        {pending?.kind === 'remove' ? (
          <p className="text-xs leading-relaxed text-muted">
            它跑过的会话会变成「内核缺失」，历史仍留在磁盘上，重新装回同一个内核即可再打开。
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-xs leading-relaxed text-muted">
              内核可以读取 Pictor 的模型服务配置，其中包含当前服务的密钥 —— 这是它能跑起来的前提。
              装好后它会出现在首页的内核选择里，每个新会话都属于所选的内核。
            </p>
            {pending?.kind === 'package' && (
              <Input
                autoFocus
                aria-label="内核包名"
                placeholder="@acme/pictor-kernel-codex"
                value={pending.spec}
                onChange={(event) => {
                  setPending({ kind: 'package', spec: event.currentTarget.value })
                }}
              />
            )}
            {pending?.kind === 'package' && (
              <p className="text-2xs leading-relaxed text-faint">
                由 npm 装进内核目录，可以带自己的依赖。目录安装则要求目录自包含。
              </p>
            )}
          </div>
        )}
      </Dialog>
    </Section>
  )
}
