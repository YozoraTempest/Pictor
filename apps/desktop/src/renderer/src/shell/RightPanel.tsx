import { Wrench, X } from 'lucide-react'

import { useUiStore } from '../app/ui-store.js'
import { IconButton } from '../components/ui/index.js'

/**
 * The right panel is an extension surface: built-in tools (browser, side chat)
 * and plugin-provided views land here. Until those exist it states the intent
 * rather than listing dead entries.
 */
export function RightPanel(): React.JSX.Element {
  const toggleRightPanel = useUiStore((state) => state.toggleRightPanel)

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden border-l border-border bg-surface/30">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border pr-2 pl-3">
        <h2 className="text-2xs font-semibold tracking-wider text-faint uppercase">工具</h2>
        <IconButton label="收起工具面板" className="size-7" onClick={toggleRightPanel}>
          <X className="size-3.5" />
        </IconButton>
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <Wrench className="size-4 text-faint" aria-hidden />
        <p className="text-sm text-muted">还没有可用工具</p>
        <p className="text-2xs leading-relaxed text-faint">
          内置浏览器、侧边聊天与插件提供的工具视图都会出现在这里。
        </p>
      </div>
    </aside>
  )
}
