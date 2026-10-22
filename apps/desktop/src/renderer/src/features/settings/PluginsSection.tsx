import { ShieldAlert } from 'lucide-react'

import { useWorkspaceStore } from '../../app/workspace-store.js'
import { Badge, Spinner, Switch } from '../../components/ui/index.js'
import { Section } from './Section.js'
import { SettingRow } from './SettingRow.js'

export function PluginsSection(): React.JSX.Element {
  const plugins = useWorkspaceStore((state) => state.plugins)
  const report = useWorkspaceStore((state) => state.report)
  const busy = useWorkspaceStore((state) => state.busy)
  const setPluginEnabled = useWorkspaceStore((state) => state.setPluginEnabled)

  const failures = report?.failures ?? []

  return (
    <Section
      title="已安装插件"
      description="插件可以扩展命令与工具；停用后不会在启动时激活。"
      actions={
        <Badge tone="neutral">
          {plugins.filter((plugin) => plugin.enabled).length} / {plugins.length} 已启用
        </Badge>
      }
      padded={false}
    >
      {plugins.length === 0 ? (
        <SettingRow
          title="还没有安装插件"
          description="把插件放进插件目录后重新加载即可。"
          control={null}
        />
      ) : (
        plugins.map((plugin) => (
          <SettingRow
            key={plugin.id}
            title={plugin.id}
            description={`v${plugin.version} · ${plugin.source}`}
            control={
              busy ? (
                <Spinner className="size-3.5" />
              ) : (
                <Switch
                  label={`切换插件 ${plugin.id}`}
                  checked={plugin.enabled}
                  onChange={(enabled) => void setPluginEnabled(plugin.id, enabled)}
                />
              )
            }
          />
        ))
      )}

      {failures.length > 0 && (
        <div className="flex flex-col gap-1.5 px-4 py-3">
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
