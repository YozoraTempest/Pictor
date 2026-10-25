import { useWorkspaceStore } from '../../app/workspace-store.js'
import { cn } from '../../lib/cn.js'
import type { GroupingMode } from '../sessions/grouping.js'
import { DefaultPermissionSection } from './DefaultPermissionSection.js'
import { Section } from './Section.js'
import { SettingRow } from './SettingRow.js'

const MODES: Array<{ id: GroupingMode; label: string; description: string }> = [
  {
    id: 'overlap',
    label: '允许重复',
    description: '会话同时出现在它所属的每个分区里，置顶、项目、自定义分区都会列出它。',
  },
  {
    id: 'pinned',
    label: '置顶互斥',
    description: '置顶会话只出现在「置顶」，其余会话仍可能同时出现在项目与自定义分区。',
  },
  {
    id: 'basic',
    label: '基本互斥',
    description:
      '在「全部互斥」基础上，只有「最近」不被限制：它按时间列出所有会话，方便回看时间线。',
  },
  {
    id: 'exclusive',
    label: '全部互斥',
    description:
      '每个会话只属于一个分区：置顶优先，其次是会话标记的分区、项目所在的分区，最后才是项目或最近。',
  },
]

export function GeneralSection(): React.JSX.Element {
  const groupingMode = useWorkspaceStore((state) => state.groupingMode)
  const setGroupingMode = useWorkspaceStore((state) => state.setGroupingMode)

  return (
    <>
      <Section
        title="会话列表"
        description="左栏按「分区 → 项目 → 会话」三层展示，置顶会话始终排在最前面。"
        padded={false}
      >
        <SettingRow
          id="sessions.grouping"
          stacked
          title="会话出现在哪些分区"
          description="点选后立即生效。"
          control={
            <div
              className="flex flex-col gap-1.5"
              role="radiogroup"
              aria-label="会话出现在哪些分区"
            >
              {MODES.map((mode) => {
                const active = mode.id === groupingMode

                return (
                  <button
                    key={mode.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => void setGroupingMode(mode.id)}
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
                        aria-hidden
                      >
                        {active && <span className="size-1.5 rounded-full bg-accent" />}
                      </span>
                      {mode.label}
                    </span>
                    <span className="mt-0.5 block pl-5.5 text-2xs text-faint">
                      {mode.description}
                    </span>
                  </button>
                )
              })}
            </div>
          }
        />
      </Section>

      <DefaultPermissionSection />
    </>
  )
}
