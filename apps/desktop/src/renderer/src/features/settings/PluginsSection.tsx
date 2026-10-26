import { useCallback, useEffect, useState } from 'react'

import type { PluginOverview } from '../../../../shared/bridge.js'
import { Button } from '../../components/ui/Button.js'
import { Dialog } from '../../components/ui/Dialog.js'
import { Input } from '../../components/ui/Input.js'
import { Switch } from '../../components/ui/Switch.js'
import { cn } from '../../lib/cn.js'
import { Section } from './Section.js'

/** Contribution points, in the words the page uses for them. */
const POINT_LABEL: Record<string, string> = {
  commands: '命令',
  panels: '面板',
  toolGuards: '工具守卫',
  toolViews: '工具展示',
  skills: '技能',
  kernel: '内核',
}

/** What a kernel can reach, in words a person can judge. */
const SERVICE_LABEL: Record<string, string> = {
  'pictor.models': '模型服务（含密钥）',
  'pictor.rules': '工具规则',
  'pictor.guard': '工具守卫端点',
  'pictor.permission': '默认权限模式',
  'pictor.workspace': '会话工作目录',
  'pictor.userdata': '数据目录',
}

function serviceLabel(name: string): string {
  return SERVICE_LABEL[name] ?? name
}

/** What the window is about to do, once the person has confirmed it. */
type Pending =
  | { kind: 'folder' }
  | { kind: 'package'; spec: string }
  | { kind: 'remove'; name: string; label: string }

/**
 * Everything a plugin can add, in one list.
 *
 * A plugin is one installation that may contribute several things — panels, guards,
 * skills, a whole kernel — so the page lists installations rather than contributions:
 * that is what a person installed, what they can turn off, and what they would remove.
 * Each row states what it adds and what it can reach, because installing one hands it
 * the model service, key included.
 */
export function PluginsSection(): React.JSX.Element {
  const [overview, setOverview] = useState<PluginOverview[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const [home, setHome] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      setOverview(await window.pictor.listPluginOverview())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [])

  useEffect(() => {
    void load()
    void window.pictor
      .getAppInfo()
      .then((info) => {
        const index = Math.max(info.database.lastIndexOf('/'), info.database.lastIndexOf('\\'))
        setHome(index > 0 ? info.database.slice(0, index) : null)
      })
      .catch(() => undefined)
  }, [load])

  async function toggle(plugin: PluginOverview, enabled: boolean): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await window.pictor.setPluginEnabled(plugin.id, enabled)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  async function submit(): Promise<void> {
    if (pending === null) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      if (pending.kind === 'remove') {
        const result = await window.pictor.removeKernel(pending.name)
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

  const all = overview ?? []
  const enabled = all.filter((plugin) => plugin.enabled).length
  const broken = all.filter((plugin) => plugin.failure !== null)

  return (
    <Section
      title="插件"
      description="插件可以给应用加面板、工具守卫、技能，或者一整个内核。装完不用重启。"
      actions={
        <>
          <Button size="sm" variant="secondary" onClick={() => setPending({ kind: 'folder' })}>
            从目录安装
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setPending({ kind: 'package', spec: '' })}
          >
            从 npm 安装
          </Button>
        </>
      }
    >
      {overview === null && error === null && <p className="text-xs text-faint">读取中…</p>}

      {overview !== null && all.length === 0 && (
        <p className="text-xs text-faint">
          还没有安装插件。装一个，它会出现在这里和首页的内核选择里。
        </p>
      )}

      {all.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="已安装插件">
          {all.map((plugin) => (
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
                <span className="ml-auto flex items-center gap-2">
                  <span className="text-2xs text-faint">v{plugin.version}</span>
                  {plugin.source !== 'builtin' && (
                    <Switch
                      label={`切换插件 ${plugin.label}`}
                      checked={plugin.enabled}
                      onChange={(next) => void toggle(plugin, next)}
                    />
                  )}
                </span>
              </div>

              <p className="mt-1 text-2xs text-faint">
                {plugin.source === 'builtin' ? '随应用编译' : `已安装：${plugin.source}`}
              </p>

              {plugin.failure !== null && (
                <p className="mt-1.5 text-2xs leading-relaxed text-danger" role="alert">
                  {plugin.failure}
                </p>
              )}

              {plugin.contributions.length > 0 && (
                <p className="mt-1.5 text-2xs leading-relaxed text-muted">
                  贡献：
                  {plugin.contributions
                    .map(
                      (entry) =>
                        `${POINT_LABEL[entry.point] ?? entry.point} ${String(entry.count)}`,
                    )
                    .join(' · ')}
                </p>
              )}

              {plugin.kernels.map((kernel) => (
                <p key={kernel.id} className="mt-1 text-2xs leading-relaxed text-muted">
                  内核 {kernel.label}
                  {kernel.available ? '' : '（未安装）'} ·{' '}
                  {kernel.services.length === 0
                    ? '不读取任何宿主服务'
                    : `可以读取：${kernel.services.map(serviceLabel).join('、')}`}
                </p>
              ))}

              {plugin.source !== 'builtin' && (
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    className="rounded-sm px-1.5 py-0.5 text-2xs text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-danger"
                    onClick={() =>
                      setPending({ kind: 'remove', name: plugin.source, label: plugin.label })
                    }
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
          未挂载的插件不会出现在首页的内核选择里；修好它再重启即可，其余插件不受影响。
        </p>
      )}

      <p className="text-2xs leading-relaxed text-faint">
        {home === null
          ? '插件装在应用数据目录下的 plugins/ 里。'
          : `插件装在 ${home}/plugins/ 里：目录安装整份复制，包安装由 npm 装进它的 node_modules。`}
        插件在主进程里运行，能读写这台机器上的文件与网络；插件贡献的内核还会拿到含密钥的模型服务配置。
      </p>

      {all.length > 0 && (
        <p className="text-2xs text-faint">
          {enabled} / {all.length} 已启用
        </p>
      )}

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
              ? '从 npm 安装插件'
              : '从目录安装插件'
        }
        onClose={() => {
          if (!busy) setPending(null)
        }}
        footer={
          <>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setPending(null)}>
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
            它贡献的面板、规则和内核会一起撤下；内核跑过的会话会变成「内核缺失」，历史仍留在磁盘上。
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-xs leading-relaxed text-muted">
              插件在主进程里运行，能读写这台机器上的文件和网络；如果它贡献内核，还会拿到含密钥的模型服务配置。
              装之前先确认它来自你信任的地方。
            </p>
            {pending?.kind === 'package' && (
              <Input
                autoFocus
                aria-label="插件包名"
                placeholder="@acme/pictor-kernel-codex"
                value={pending.spec}
                onChange={(event) => {
                  setPending({ kind: 'package', spec: event.currentTarget.value })
                }}
              />
            )}
            {pending?.kind === 'package' && (
              <p className="text-2xs leading-relaxed text-faint">
                由 npm 装进插件目录，可以带自己的依赖。目录安装则要求目录自包含。
              </p>
            )}
          </div>
        )}
      </Dialog>
    </Section>
  )
}
