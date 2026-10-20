import type { ReactNode } from 'react'

import { Panel } from '../../components/ui/index.js'

/**
 * A settings card: a titled panel with the settings-specific density.
 *
 * Kept as a named wrapper so the settings pages read as a list of sections,
 * while the border, surface and header layout stay owned by `Panel`.
 */
export function Section({
  title,
  description,
  children,
  actions,
}: {
  title: string
  description?: string
  children: ReactNode
  actions?: ReactNode
}): React.JSX.Element {
  return (
    <Panel
      title={title}
      description={description}
      actions={actions}
      className="bg-surface/40"
      headerClassName="border-b border-border px-4 py-3"
      titleClassName="text-sm font-medium tracking-normal text-text normal-case"
      bodyClassName="gap-4 px-4 py-4"
    >
      {children}
    </Panel>
  )
}
