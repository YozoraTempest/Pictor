import { Blocks, ShieldAlert } from 'lucide-react'

import { useWorkspaceStore } from '../../app/workspace-store.js'
import { Badge, Spinner, Switch } from '../../components/ui/index.js'
import { Section } from './Section.js'

export function PluginsSection(): React.JSX.Element {
  const plugins = useWorkspaceStore((state) => state.plugins)
  const report = useWorkspaceStore((state) => state.report)
  const busy = useWorkspaceStore((state) => state.busy)
  const setPluginEnabled = useWorkspaceStore((state) => state.setPluginEnabled)

  const failures = report?.failures ?? []

  return (
    <Section
      title="插件"
      description="插件可以扩展命令与工具；停用后不会在启动时激活。"
      actions={
        <Badge tone="neutral">
          {plugins.filter((plugin) => plugin.enabled).length} / {plugins.length} 已启用
        </Badge>
      }
    >
      {plugins.length === 0 ? (
        <p className="text-xs text-faint">还没有安装插件。</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {plugins.map((plugin) => (
            <li
              key={plugin.id}
              className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2"
            >
              <Blocks className="size-3.5 shrink-0 text-faint" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-text">{plugin.id}</p>
                <p className="truncate text-2xs text-faint">
                  v{plugin.version} · {plugin.source}
                </p>
              </div>
              {busy ? (
                <Spinner className="size-3.5" />
              ) : (
                <Switch
                  label={`切换插件 ${plugin.id}`}
                  checked={plugin.enabled}
                  onChange={(enabled) => void setPluginEnabled(plugin.id, enabled)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {failures.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-md border border-danger/30 bg-danger/5 px-3 py-2">
          <h3 className="flex items-center gap-1.5 text-2xs font-semibold tracking-wider text-danger uppercase">
            <ShieldAlert className="size-3" />
            加载失败
          </h3>
          {failures.map((failure) => (
            <div key={failure.source} className="text-2xs">
              <Badge tone="danger" className="mr-1.5">
                {failure.source}
              </Badge>
              <span className="text-muted">{failure.reason}</span>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}
