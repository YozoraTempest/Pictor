import { FolderOpen } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { HarnessStatus } from '../../../main/bridge.js'
import { useWorkspaceStore } from '../../app/workspace-store.js'
import { Button } from '@vulonlok/ui'
import { Section } from './Section.js'

export function AboutSection(): React.JSX.Element {
  const info = useWorkspaceStore((state) => state.info)
  const report = useWorkspaceStore((state) => state.report)
  const projects = useWorkspaceStore((state) => state.projects)
  const sessions = useWorkspaceStore((state) => state.sessions)
  const [runtime, setRuntime] = useState<HarnessStatus | null>(null)

  // Where the kernel keeps its profiles and session logs: a diagnostic, so it
  // lives here rather than on the page that manages the process.
  useEffect(() => {
    void window.pictor
      .harnessStatus()
      .then(setRuntime)
      .catch(() => undefined)
  }, [])

  const rows: Array<[string, string]> = [
    ['版本', info?.version ?? '—'],
    ['Electron', info?.electron ?? '—'],
    ['Node', info?.node ?? '—'],
    ['host-core', info?.hostCore ?? '—'],
    ['项目', String(projects.length)],
    ['会话', String(sessions.length)],
    ['已激活插件', report === null ? '—' : String(report.activated.length)],
  ]

  return (
    <Section title="版本信息" description="运行版本与本地数据位置。">
      <dl className="flex flex-col gap-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3">
            <dt className="text-xs text-faint">{label}</dt>
            <dd className="truncate font-mono text-xs text-muted">{value}</dd>
          </div>
        ))}

        <div className="mt-1 flex flex-col gap-1">
          <dt className="text-xs text-faint">数据库</dt>
          <dd className="selectable break-all font-mono text-2xs text-muted">
            {info?.database ?? '—'}
          </dd>
        </div>

        {runtime !== null && (
          <div className="flex flex-col gap-1">
            <dt className="flex items-center justify-between gap-3 text-xs text-faint">
              内核目录
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void window.pictor.showInFolder(runtime.home)}
              >
                <FolderOpen className="size-3.5" />
                打开
              </Button>
            </dt>
            <dd className="selectable break-all font-mono text-2xs text-muted">{runtime.home}</dd>
          </div>
        )}
      </dl>
    </Section>
  )
}
