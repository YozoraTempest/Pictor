import { useCallback, useEffect, useState } from 'react'

import type { BuiltinKernelInfo, PluginHomes, PluginOverview } from '../../../../shared/bridge.js'
import { Button } from '../../components/ui/Button.js'
import { Dialog } from '../../components/ui/Dialog.js'
import { Input } from '../../components/ui/Input.js'
import { Switch } from '../../components/ui/Switch.js'
import { cn } from '../../lib/cn.js'
import { Section } from './Section.js'
import { SettingRow } from './SettingRow.js'

/** Contribution points, in the words the page uses for them. */
const POINT_LABEL: Record<string, string> = {
  panels: '面板',
  views: '视图',
  toolGuards: '工具守卫',
  toolHooks: '执行后钩子',
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
  // A kernel's own key/value entries: it can read back what the person chose.
  'pictor.settings': '设置读写（含它自己的键）',
}

/**
 * Where a plugin came from, what it adds, and — folded — what it can reach.
 *
 * Three facts on one line. They used to be three paragraphs under every row, which made
 * a page of six plugins read like six explanations of the plugin system.
 */
function PluginMeta({ plugin }: { plugin: PluginOverview }): React.JSX.Element {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-faint">
      <span>{plugin.source === 'builtin' ? '随应用提供' : `已安装 · ${plugin.source}`}</span>

      {plugin.contributions.length > 0 && (
        <span>
          {plugin.contributions
            .map((entry) => `${POINT_LABEL[entry.point] ?? entry.point} ${String(entry.count)}`)
            .join(' · ')}
        </span>
      )}

      {plugin.kernels.map((kernel) => (
        <span key={kernel.id} className="flex items-center gap-2">
          内核 {kernel.label}
          {kernel.available ? null : '（未安装）'}
          <ServiceCount services={kernel.services} />
        </span>
      ))}
    </div>
  )
}

/**
 * How much of the host a kernel can reach, closed by default.
 *
 * The list itself has to stay somewhere — it is what a person consents to when they
 * install — but a line of eight service names under every row is a wall, not a fact.
 */
function ServiceCount({ services }: { services: readonly string[] }): React.JSX.Element {
  if (services.length === 0) return <span>不读取宿主服务</span>

  return (
    <details className="inline-block">
      <summary className="cursor-pointer select-none hover:text-muted">
        可读 {String(services.length)} 项
      </summary>
      <ul className="mt-1 flex flex-col gap-0.5 border-l border-border pl-2">
        {services.map((name) => (
          <li key={name}>{serviceLabel(name)}</li>
        ))}
      </ul>
    </details>
  )
}

/** `~/config/pictor/plugins` reads better than a home directory spelled out. */
function shortPath(path: string): string {
  const home = path.match(/^\/(?:home|Users)\/[^/]+\//)
  return home === null ? path : `~/${path.slice(home[0].length)}`
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
  const [builtins, setBuiltins] = useState<BuiltinKernelInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const [homes, setHomes] = useState<PluginHomes | null>(null)
  const [hotReload, setHotReload] = useState<boolean | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      const [plugins, kernels] = await Promise.all([
        window.pictor.listPluginOverview(),
        window.pictor.listBuiltinKernels(),
      ])
      setOverview(plugins)
      setBuiltins(kernels)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [])

  // The list follows the disk: writing a plugin folder while this page is open adds a row
  // without a reload, and deleting one takes it away.
  useEffect(() => window.pictor.onWorkspaceChanged(() => void load()), [load])

  useEffect(() => {
    void load()
    void window.pictor
      .pluginsHotReload()
      .then(setHotReload)
      .catch(() => undefined)
    void window.pictor
      .pluginHomes()
      .then(setHomes)
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

  /** Switches a built-in kernel on or off; it is mounted or unmounted, not removed. */
  async function toggleBuiltin(kernel: BuiltinKernelInfo, enabled: boolean): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await window.pictor.setBuiltinKernelEnabled(kernel.id, enabled)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Turns file watching on or off.
   *
   * The watchers belong to the running process, so the new value lands on the next
   * launch; the row says so instead of pretending it already did.
   */
  async function toggleHotReload(next: boolean): Promise<void> {
    setError(null)
    try {
      await window.pictor.putSetting('plugins.hotReload', next)
      setNotice(next ? '已开启热重载，下次启动生效。' : '已关闭热重载，下次启动生效。')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  /** Points new conversations at another kernel; open ones keep theirs. */
  async function makeDefault(kernel: BuiltinKernelInfo): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      if (await window.pictor.setDefaultKernel(kernel.id)) {
        setNotice(`新会话将从「${kernel.label}」开始`)
      }
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
    // No heading of its own: the extensions panel names this tab, and the card is the
    // content. What is left of a header is the sentence a reader needs and the two ways
    // to add something — one row, right where the eye lands.
    <Section
      // The rows are cards themselves, so this section draws no card of its own.
      bare
      description={
        overview === null
          ? '读取中'
          : all.length === 0
            ? '还没有插件'
            : `${String(all.length)} 个插件 · ${String(enabled)} 个启用`
      }
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
                'rounded-lg border bg-surface px-3 py-2.5',
                plugin.failure === null ? 'border-border' : 'border-danger/40 bg-danger/5',
              )}
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-xs text-text">{plugin.label}</span>
                <span className="font-mono text-2xs text-faint">{plugin.id}</span>
                <span className="ml-auto flex items-center gap-2">
                  <span className="text-2xs text-faint">v{plugin.version}</span>
                  <Switch
                    label={`切换插件 ${plugin.label}`}
                    checked={plugin.enabled}
                    onChange={(next) => void toggle(plugin, next)}
                  />
                </span>
              </div>

              {/* One line of metadata instead of four paragraphs: where it came from,
                  what it adds, and — folded — what it can reach. */}
              <PluginMeta plugin={plugin} />

              {plugin.failure !== null && (
                <p className="mt-1.5 text-2xs leading-relaxed text-danger" role="alert">
                  {plugin.failure}
                </p>
              )}

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

      {builtins.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-2xs font-semibold tracking-wider text-faint uppercase">随应用编译</h3>
          <ul className="flex flex-col gap-2" aria-label="内置内核">
            {builtins.map((kernel) => (
              <li
                key={kernel.id}
                className="rounded-lg border border-border bg-surface px-3 py-2.5"
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-xs text-text">{kernel.label}</span>
                  <span className="font-mono text-2xs text-faint">{kernel.id}</span>
                  {kernel.default && <span className="text-2xs text-accent">新会话默认</span>}
                  <span className="ml-auto flex items-center gap-2">
                    {!kernel.default && kernel.enabled && (
                      <button
                        type="button"
                        disabled={busy}
                        className="rounded-sm px-1.5 py-0.5 text-2xs text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text"
                        onClick={() => void makeDefault(kernel)}
                      >
                        设为默认
                      </button>
                    )}
                    <Switch
                      label={`切换内核 ${kernel.label}`}
                      checked={kernel.enabled}
                      onChange={(next) => void toggleBuiltin(kernel, next)}
                    />
                  </span>
                </div>

                {/* The group heading already says 「随应用编译」; the row only adds what
                    is specific to it. */}
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-faint">
                  {kernel.enabled ? (
                    <ServiceCount services={kernel.services} />
                  ) : (
                    <span>已关闭</span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {broken.length > 0 && (
        <p className="text-2xs leading-relaxed text-faint">
          未挂载的插件不会出现在首页的内核选择里；修好它再重启即可，其余插件不受影响。
        </p>
      )}

      <SettingRow
        title="编辑后自动重载"
        description={
          hotReload === null
            ? '读取中'
            : hotReload
              ? '插件文件一改就重新挂载。代价是旧模块留在内存里，改动要重启才彻底清干净。'
              : '关掉了：改插件要重启应用。'
        }
        control={
          <Switch
            label="切换热重载"
            checked={hotReload ?? false}
            disabled={hotReload === null}
            onChange={(next) => void toggleHotReload(next)}
          />
        }
      />

      <p className="text-2xs leading-relaxed text-faint">
        主进程内运行，可读写本机文件与网络；带内核的还会拿到含密钥的模型服务。
      </p>

      {/*
        Two paths, because they answer two different questions: where an installed plugin
        went, and where to write one. The second is the one a person needs to act on.
      */}
      {homes !== null && (
        <dl className="flex flex-col gap-1 text-2xs leading-relaxed text-faint">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <dt>已安装</dt>
            <dd className="font-mono">{shortPath(homes.installed)}</dd>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <dt>开发</dt>
            <dd className="font-mono">{shortPath(homes.development)}</dd>
            <dd>放进去就生效，删掉就卸载</dd>
          </div>
        </dl>
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
