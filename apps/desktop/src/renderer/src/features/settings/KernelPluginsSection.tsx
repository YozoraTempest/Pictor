import { useCallback, useEffect, useState } from 'react'

import type { KernelPlugin } from '../../../../shared/bridge.js'
import { Button } from '../../components/ui/Button.js'
import { Dialog } from '../../components/ui/Dialog.js'
import { Input } from '../../components/ui/Input.js'
import { Field } from '../../components/ui/Field.js'
import { Switch } from '../../components/ui/Switch.js'
import { Section } from './Section.js'

/**
 * dsh plugins: packages the **kernel** loads, in the kernel's own process.
 *
 * Kept apart from the plugins above because they are a different tree with a different
 * reach: a plugin here adds tools the model can call, and nothing of Pictor's window. The
 * sentence under the list says so, because a person who installs one and waits for a panel
 * deserves to know why none appears.
 *
 * Installing stages a package in the kernel's profile and writes an entry into the patch
 * Pictor generates on every boot; the kernel is restarted to read it. That is the same
 * contract MCP servers already have, so the page says 「重启内核后生效」 rather than
 * pretending the list is live.
 */
export function KernelPluginsSection(): React.JSX.Element {
  const [plugins, setPlugins] = useState<KernelPlugin[] | null>(null)
  const [profile, setProfile] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [spec, setSpec] = useState<string | null>(null)
  const [removing, setRemoving] = useState<KernelPlugin | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    try {
      const [listed, home] = await Promise.all([
        window.pictor.listDshPlugins(),
        window.pictor.dshPluginHome(),
      ])
      setPlugins(listed)
      setProfile(home.profile)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function install(): Promise<void> {
    if (spec === null || spec.trim().length === 0) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await window.pictor.installDshPlugin(spec.trim())
      setNotice(
        result.mount === 'bundle'
          ? `已安装 ${result.plugin.name}（自带 patch 的组合包）· 重启内核后生效`
          : `已安装 ${result.plugin.name} · 重启内核后生效`,
      )
      setSpec(null)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  async function toggle(plugin: KernelPlugin, enabled: boolean): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      setPlugins(await window.pictor.setDshPluginEnabled(plugin.id, enabled))
      setNotice(`${plugin.name} ${enabled ? '已开' : '已关'} · 重启内核后生效`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  async function remove(): Promise<void> {
    if (removing === null) return
    setBusy(true)
    setError(null)
    try {
      await window.pictor.removeDshPlugin(removing.id)
      setNotice(`已移除 ${removing.name}`)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
      setRemoving(null)
    }
  }

  const list = plugins ?? []
  const on = list.filter((plugin) => plugin.enabled).length

  return (
    <Section
      bare
      description={
        plugins === null
          ? '读取中'
          : list.length === 0
            ? '内核插件：装在内核自己进程里的 dsh 插件'
            : `内核插件 ${String(list.length)} 个 · ${String(on)} 个启用`
      }
      actions={
        <Button size="sm" variant="secondary" onClick={() => setSpec('')}>
          安装内核插件
        </Button>
      }
    >
      {list.length === 0 && plugins !== null && (
        <p className="text-xs leading-relaxed text-faint">
          装在内核那边，给模型加工具或改行为；它们不会在右栏出现面板，那是上面那类插件的事。
        </p>
      )}

      {list.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="内核插件">
          {list.map((plugin) => (
            <li key={plugin.id} className="rounded-lg border border-border bg-surface px-3 py-2.5">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-xs text-text">{plugin.name}</span>
                <span className="font-mono text-2xs text-faint">{plugin.id}</span>
                <span className="ml-auto flex items-center gap-2">
                  <span className="text-2xs text-faint">
                    {plugin.version === null ? '内核侧' : `v${plugin.version}`}
                  </span>
                  <Switch
                    label={`切换内核插件 ${plugin.name}`}
                    checked={plugin.enabled}
                    disabled={busy}
                    onChange={(next) => void toggle(plugin, next)}
                  />
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-faint">
                <span>{plugin.source === 'npm' ? '从 npm 安装' : plugin.source}</span>
                <button
                  type="button"
                  className="hover:text-danger"
                  onClick={() => setRemoving(plugin)}
                >
                  移除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-2xs leading-relaxed text-faint">
        在内核进程里运行，能加工具、改行为；不会画界面。改动要重启内核才生效。
        {profile !== null && <span className="ml-1 font-mono">{shortPath(profile)}</span>}
      </p>

      {notice !== null && <p className="text-2xs leading-relaxed text-muted">{notice}</p>}
      {error !== null && (
        <p className="text-2xs text-danger" role="alert">
          {error}
        </p>
      )}

      <Dialog
        open={spec !== null}
        title="安装内核插件"
        onClose={() => setSpec(null)}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setSpec(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={busy || (spec ?? '').trim().length === 0}
              onClick={() => void install()}
            >
              {busy ? '安装中…' : '安装'}
            </Button>
          </>
        }
      >
        <p className="mb-2 text-xs leading-relaxed text-muted">
          用包名（<span className="font-mono text-2xs">@deepseek-ai/dsh-tool-terminal</span>）、
          <span className="font-mono text-2xs">file: /路径</span>，或 npm 认识的 git/tarball 地址。
          装在 dsh 的 profile 里，重启内核后生效。
        </p>
        <Field label="包名或地址">
          <Input
            value={spec ?? ''}
            onChange={(event) => setSpec(event.target.value)}
            placeholder="@deepseek-ai/dsh-tool-terminal"
          />
        </Field>
      </Dialog>

      <Dialog
        open={removing !== null}
        title={`移除 ${removing?.name ?? ''}？`}
        onClose={() => setRemoving(null)}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setRemoving(null)}>
              取消
            </Button>
            <Button variant="danger" size="sm" disabled={busy} onClick={() => void remove()}>
              移除
            </Button>
          </>
        }
      >
        <p className="text-xs leading-relaxed text-muted">
          会从 profile 卸载这个包，并删掉它写进 patch 的条目。重启内核后它就不在了。
        </p>
      </Dialog>
    </Section>
  )
}

/** `~/config/pictor/...` reads better than a home directory spelled out. */
function shortPath(path: string): string {
  const home = path.match(/^\/(?:home|Users)\/[^/]+\//)
  return home === null ? path : `~/${path.slice(home[0].length)}`
}
