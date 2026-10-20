import { Play } from 'lucide-react'

import { useWorkspaceStore } from '../../app/workspace-store.js'
import { Badge, Button, EmptyState } from '../../components/ui/index.js'

export function CommandsPanel(): React.JSX.Element {
  const commands = useWorkspaceStore((state) => state.commands)
  const notice = useWorkspaceStore((state) => state.notice)
  const busy = useWorkspaceStore((state) => state.busy)
  const runCommand = useWorkspaceStore((state) => state.runCommand)

  if (commands.length === 0) {
    return <EmptyState title="没有可用命令" description="核心与插件注册的命令会显示在这里。" />
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <ul className="flex flex-col gap-1">
        {commands.map((command) => (
          <li
            key={command.id}
            className="flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-xs text-text">{command.id}</p>
              <p className="truncate text-2xs text-faint">{command.description}</p>
            </div>
            <Badge tone={command.source === 'core' ? 'neutral' : 'accent'} className="shrink-0">
              {command.source}
            </Badge>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void runCommand(command.id)}
              aria-label={`执行 ${command.id}`}
            >
              <Play className="size-3" />
            </Button>
          </li>
        ))}
      </ul>

      {notice !== null && (
        <pre className="selectable max-h-48 overflow-auto rounded-md border border-border bg-bg px-2.5 py-2 font-mono text-2xs leading-relaxed whitespace-pre-wrap text-muted">
          {notice}
        </pre>
      )}
    </div>
  )
}
