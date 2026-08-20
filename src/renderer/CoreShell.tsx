import { Blocks } from 'lucide-react'
import { useState } from 'react'

import type { ShellApplication } from '../modules/shell/application'
import type { SettingsSection } from '../modules/shell/settings'
import type { PluginStatus } from '../plugin/host'
import { Modal } from './ui/Modal'
import { PluginManager } from './settings/PluginManager'

interface CoreShellProps {
  application: ShellApplication | null
  settingsSections: readonly SettingsSection[]
  rendererPluginStatuses: readonly PluginStatus[]
}

export function CoreShell({
  application,
  settingsSections,
  rendererPluginStatuses,
}: CoreShellProps): React.JSX.Element {
  const [managerOpen, setManagerOpen] = useState(false)

  if (application) {
    return <>{application.render({ settingsSections, rendererPluginStatuses })}</>
  }

  return (
    <main className="core-shell">
      <header className="core-shell__header">
        <div className="brand-mark" aria-hidden="true">
          P
        </div>
        <strong>Pictor</strong>
      </header>
      <section className="core-shell__empty">
        <Blocks size={28} />
        <h1>Plugin Manager</h1>
        <button className="primary-button" type="button" onClick={() => setManagerOpen(true)}>
          <Blocks size={15} />
          打开 Plugin Manager
        </button>
      </section>
      {managerOpen ? (
        <Modal title="Plugin Manager" onClose={() => setManagerOpen(false)} width="wide">
          <PluginManager rendererPluginStatuses={rendererPluginStatuses} />
        </Modal>
      ) : null}
    </main>
  )
}
