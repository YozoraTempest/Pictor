import { useEffect, useState } from 'react'

import type { KernelPluginInfo } from '../../../../shared/bridge.js'
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

/**
 * The kernels this app will run, including the ones it does not know about.
 *
 * Two of them are compiled in and the rest are directories under the profile, but
 * the page does not distinguish beyond saying where each came from: what matters is
 * that a third-party kernel is listed with the services it declared, so trusting one
 * is a decision made with the facts in front of you.
 */
export function KernelPluginsSection(): React.JSX.Element {
  const [plugins, setPlugins] = useState<KernelPluginInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [home, setHome] = useState<string | null>(null)

  useEffect(() => {
    void window.pictor
      .listKernelPlugins()
      .then(setPlugins)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      )
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

  const broken = (plugins ?? []).filter((entry) => entry.failure !== null)

  return (
    <Section
      title="内核插件"
      description="会话由内核执行。装一个内核就是放一个目录，它在下次启动时挂载。"
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
          ? '内核目录在应用数据目录下的 kernels/ 里。'
          : `把内核包放进 ${home}/kernels/ 后重启应用生效。`}
        第三方内核拿到的模型服务包含当前服务的密钥，这是它能跑起来的前提。
      </p>

      {error !== null && (
        <p className="text-2xs text-danger" role="alert">
          {error}
        </p>
      )}
    </Section>
  )
}
