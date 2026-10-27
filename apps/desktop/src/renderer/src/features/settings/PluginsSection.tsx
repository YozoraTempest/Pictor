import { useCallback, useEffect, useState } from 'react'

import type {
  KernelPlugin,
  PluginHomes,
  PluginInstallSummary,
  PluginOverview,
} from '../../../../shared/bridge.js'
import { Button } from '../../components/ui/Button.js'
import { Dialog } from '../../components/ui/Dialog.js'
import { Input } from '../../components/ui/Input.js'
import { Switch } from '../../components/ui/Switch.js'
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

/** `~/config/pictor/plugins` reads better than a home directory spelled out. */
function shortPath(path: string): string {
  const home = path.match(/^\/(?:home|Users)\/[^/]+\//)
  return home === null ? path : `~/${path.slice(home[0].length)}`
}

/** What the window is about to do, once the person has confirmed it. */
type Pending =
  | { kind: 'install'; spec: string; targets: Array<'window' | 'kernel'> | null }
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
  /** The kernel tree's packages. Merged into the list below rather than shown apart. */
  const [kernelPlugins, setKernelPlugins] = useState<KernelPlugin[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const [homes, setHomes] = useState<PluginHomes | null>(null)
  const [hotReload, setHotReload] = useState<boolean | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      const [plugins, kernelSide] = await Promise.all([
        window.pictor.listPluginOverview(),
        window.pictor.listDshPlugins(),
      ])
      setOverview(plugins)
      setKernelPlugins(kernelSide)
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

  async function submit(): Promise<void> {
    if (pending === null) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      if (pending.kind === 'remove') {
        const result = await window.pictor.removePlugin(pending.name)
        setNotice(result.ok ? `已卸载 ${pending.label}` : result.message)
      } else {
        // One call for both trees: the package's own manifest decides where it goes.
        const summary: PluginInstallSummary = await window.pictor.installPlugin(pending.spec.trim())
        setNotice(summary.message)
        if (summary.ok && summary.targets?.includes('kernel') === true) {
          setNotice(`${summary.message}。内核插件的改动要重启内核才生效。`)
        }
      }
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
      setPending(null)
    }
  }

  /**
   * A directory, through the same door.
   *
   * The picker stays because typing an absolute path is worse; what it produces is a
   * `file:` spec, so the decision about which tree still comes from the package.
   */
  async function chooseFolder(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const path = await window.pictor.choosePluginFolder()
      if (path === null) return
      const summary = await window.pictor.installPlugin(`file:${path}`)
      setNotice(summary.message)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Asks the main process what a spec declares, so the dialog can say where it goes.
   *
   * Debounced by the input itself: one request per keystroke burst would be a registry
   * query per keystroke, and the answer only matters when the person stops typing.
   */
  async function inspect(spec: string): Promise<void> {
    const value = spec.trim()
    if (value.length === 0) return
    const targets = await window.pictor.inspectPlugin(value).catch(() => [])
    setPending((current) =>
      current !== null && current.kind === 'install' && current.spec.trim() === value
        ? { kind: 'install', spec: current.spec, targets }
        : current,
    )
  }

  /** dsh-side actions: the row is the same, the tree is not. */
  async function toggleKernel(plugin: KernelPlugin, enabled: boolean): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      setKernelPlugins(await window.pictor.setDshPluginEnabled(plugin.id, enabled))
      setNotice(`${plugin.name} ${enabled ? '已开' : '已关'} · 重启内核后生效`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  async function removeDshPlugin(plugin: KernelPlugin): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await window.pictor.removeDshPlugin(plugin.id)
      setNotice(`已移除 ${plugin.name} · 重启内核后生效`)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const all = overview ?? []
  const enabled = all.filter((plugin) => plugin.enabled).length
  /**
   * One row per package, with the trees it occupies.
   *
   * Both sides are cordis; which tree a package lands in is a property of the package, not
   * a choice a person should make on this page. The window row is keyed by its manifest name
   * (`label`) because that is the package name; the kernel row is keyed by its package name.
   */
  const rows = mergedRows(all, kernelPlugins ?? [])

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
          : rows.length === 0
            ? '还没有插件'
            : `${String(rows.length)} 个插件 · ${String(enabled)} 个启用`
      }
      actions={
        <>
          <Button size="sm" variant="secondary" onClick={() => void chooseFolder()}>
            从目录安装
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setPending({ kind: 'install', spec: '', targets: null })}
          >
            安装插件
          </Button>
        </>
      }
    >
      {overview !== null && rows.length === 0 && (
        <p className="text-xs text-faint">
          还没有安装插件。装一个：能画界面的进「窗口」，加工具的进「内核 dsh」，由包自己决定。
        </p>
      )}

      {rows.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="插件">
          {rows.map((row) => (
            <li key={row.key} className="rounded-lg border border-border bg-surface px-3 py-2.5">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-xs text-text">{row.title}</span>
                <span className="font-mono text-2xs text-faint">{row.id}</span>
                <span className="ml-auto flex items-center gap-2">
                  <span className="text-2xs text-faint">
                    {row.version === null ? '内核侧' : `v${row.version}`}
                  </span>
                  {/* Where it runs. Not a category to learn — a fact about the package. */}
                  <span className="flex items-center gap-1 text-2xs text-faint">
                    {row.window !== null && <span>窗口</span>}
                    {row.window !== null && row.kernel !== null && <span>+</span>}
                    {row.kernel !== null && <span>内核 dsh</span>}
                  </span>
                </span>
              </div>

              {row.window !== null && (
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-faint">
                  <span>
                    {row.window.source === 'builtin'
                      ? '随应用提供'
                      : `已安装 · ${row.window.source}`}
                  </span>
                  {row.window.contributions.length > 0 && (
                    <span>
                      {row.window.contributions
                        .map(
                          (entry) =>
                            `${POINT_LABEL[entry.point] ?? entry.point} ${String(entry.count)}`,
                        )
                        .join(' · ')}
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-2">
                    <Switch
                      label={`切换插件 ${row.title}`}
                      checked={row.window.enabled}
                      onChange={(next) => void toggle(row.window as PluginOverview, next)}
                    />
                  </span>
                </div>
              )}

              {row.kernel !== null && (
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-faint">
                  <span>
                    {row.kernel.source === 'bundled'
                      ? '随 dsh 提供'
                      : row.kernel.source === 'npm'
                        ? '从 npm 安装'
                        : '已安装'}
                  </span>
                  <span>加工具、改行为 · 不会画界面</span>
                  <span className="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      className="rounded-sm px-1.5 py-0.5 text-2xs text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-danger"
                      disabled={busy}
                      onClick={() => void removeDshPlugin(row.kernel as KernelPlugin)}
                    >
                      移除
                    </button>
                    <Switch
                      label={`切换内核插件 ${row.title}`}
                      checked={row.kernel.enabled}
                      disabled={busy}
                      onChange={(next) => void toggleKernel(row.kernel as KernelPlugin, next)}
                    />
                  </span>
                </div>
              )}

              {row.window !== null && row.window.source !== 'builtin' && (
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    className="rounded-sm px-1.5 py-0.5 text-2xs text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-danger"
                    onClick={() =>
                      setPending({
                        kind: 'remove',
                        name: (row.window as PluginOverview).source,
                        label: row.title,
                      })
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
        「窗口」在主进程里跑，能读写本机文件与网络，带内核的还会拿到含密钥的模型服务。 「内核
        dsh」在内核进程里跑，能加工具、改行为，不画界面，改动要重启内核。
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
        title={pending?.kind === 'remove' ? `卸载 ${pending.label}？` : '安装插件'}
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
              disabled={busy || (pending?.kind === 'install' && pending.spec.trim().length === 0)}
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
              包名、<span className="font-mono text-2xs">file: /路径</span>，或 npm 认识的
              git/tarball 地址。装到哪由包自己的清单决定，不用选。
            </p>
            {pending?.kind === 'install' && (
              <Input
                autoFocus
                aria-label="插件包名或地址"
                placeholder="@deepseek-ai/dsh-tool-terminal"
                value={pending.spec}
                onChange={(event) => {
                  const spec = event.currentTarget.value
                  setPending({ kind: 'install', spec, targets: null })
                  void inspect(spec)
                }}
              />
            )}
            {/* Where it will go, while it is still being typed: the two trees are a
                property of the package, not a decision this page should ask for. */}
            {pending?.kind === 'install' && pending.targets !== null && (
              <p className="text-2xs leading-relaxed text-accent">
                会装到：
                {pending.targets.length === 0
                  ? '（读不出它的清单）'
                  : pending.targets.map(targetLabel).join(' + ')}
              </p>
            )}
          </div>
        )}
      </Dialog>
    </Section>
  )
}

/** One package, and the trees it occupies. */
interface PluginRow {
  /** The package name: the one thing both trees can be keyed by. */
  key: string
  title: string
  /** The id the plugin declares in its own manifest, which is not the package name. */
  id: string
  version: string | null
  window: PluginOverview | null
  kernel: KernelPlugin | null
}

/**
 * Two lists, one row each per package.
 *
 * The window list names a package by its manifest (`label`) and its directory (`name`); the
 * kernel list only knows the package name. So the package name is the join, and a package
 * that installed into both trees becomes one row with two state lines — which is what it is.
 */
function mergedRows(
  windowPlugins: readonly PluginOverview[],
  kernelPlugins: readonly KernelPlugin[],
): PluginRow[] {
  const rows = new Map<string, PluginRow>()

  for (const plugin of windowPlugins) {
    rows.set(plugin.label, {
      key: plugin.label,
      title: plugin.label,
      id: plugin.id,
      version: plugin.version,
      window: plugin,
      kernel: null,
    })
  }

  for (const plugin of kernelPlugins) {
    const existing = rows.get(plugin.name)
    if (existing === undefined) {
      rows.set(plugin.name, {
        key: plugin.name,
        title: plugin.name,
        id: plugin.id,
        version: plugin.version,
        window: null,
        kernel: plugin,
      })
      continue
    }
    existing.kernel = plugin
  }

  return [...rows.values()]
}

/** The two trees, in the words the badges use. */
function targetLabel(target: 'window' | 'kernel'): string {
  return target === 'window' ? '窗口（画界面）' : '内核 dsh（加工具）'
}
