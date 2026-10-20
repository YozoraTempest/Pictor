import { useWorkspaceStore } from '../../app/workspace-store.js'
import { Switch } from '../../components/ui/index.js'
import { Section } from './Section.js'

export function GeneralSection(): React.JSX.Element {
  const exclusive = useWorkspaceStore((state) => state.groupingExclusive)
  const setGroupingExclusive = useWorkspaceStore((state) => state.setGroupingExclusive)

  return (
    <Section
      title="会话列表"
      description="左栏按「分区 → 项目 → 会话」三层展示，置顶会话始终排在最前面。"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs text-text">分组互斥</p>
          <p className="mt-0.5 text-xs text-faint">
            {exclusive
              ? '置顶会话只在「置顶」分区出现，不重复进入项目或自定义分区。'
              : '置顶会话同时出现在「置顶」和它所属的分区/项目里。'}
          </p>
        </div>
        <Switch
          label="分组互斥"
          checked={exclusive}
          onChange={(value) => void setGroupingExclusive(value)}
        />
      </div>
    </Section>
  )
}
