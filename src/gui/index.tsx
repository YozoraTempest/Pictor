import { StrictMode } from 'react'
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import * as jsxDevRuntime from 'react/jsx-dev-runtime'
import * as jsxRuntime from 'react/jsx-runtime'

import type { PictorBridge } from '../shared/desktop-bridge.js'
import { pluginBootstrapSchema, type PluginBootstrap } from '../shared/plugins.js'
import { readPluginEntrypoint, type GuiPluginContext } from '../plugin/entry.js'
import { PluginHost, type PluginDefinition } from '../plugin/host.js'
import { GuiHostView, selectGuiHostView, validateGuiWorkbenchContributions } from './GuiHostView.js'
import { sanitizeGuiDiagnostic } from './diagnostics.js'
import {
  guiSettingsSectionContributions,
  guiWorkbenchContributions,
  normalizeGuiSettingsSectionContributions,
} from './contract.js'

export { GuiHostView } from './GuiHostView.js'
export {
  guiSettingsSectionContributions,
  guiWorkbenchContributions,
  normalizeGuiSettingsSectionContributions,
  type GuiPluginStatus,
  type GuiSettingsSectionContext,
  type GuiSettingsSectionContribution,
  type GuiWorkbenchContext,
  type GuiWorkbenchContribution,
} from './contract.js'
export type { GuiHostViewProps } from './GuiHostView.js'
export { installGuiPluginStyles } from './plugin-style.js'
export type { GuiPluginStyleTarget } from './plugin-style.js'

export interface GuiHostRuntime {
  stop(): Promise<void>
}

export type GuiBridge = Pick<
  PictorBridge,
  'commands' | 'getAppInfo' | 'getPluginBootstrap' | 'pickPlugin'
>

export async function startGui(
  rootElement: HTMLElement,
  bridge: GuiBridge = window.pictor,
): Promise<GuiHostRuntime> {
  const root = createRoot(rootElement)
  let pluginHost: PluginHost | null = null
  let beforeUnload: (() => void) | null = null
  let stopped = false

  const disposePluginHost = async (): Promise<void> => {
    const activePluginHost = pluginHost
    pluginHost = null
    await activePluginHost?.stop()
  }

  const stop = async (): Promise<void> => {
    if (stopped) return
    stopped = true
    if (beforeUnload) {
      window.removeEventListener('beforeunload', beforeUnload)
      beforeUnload = null
    }
    await disposePluginHost()
  }

  Object.assign(globalThis, {
    __PICTOR_REACT__: React,
    __PICTOR_JSX_RUNTIME__: jsxRuntime,
    __PICTOR_JSX_DEV_RUNTIME__: jsxDevRuntime,
  })

  try {
    validateGuiBridge(bridge)
    const appInfoResult = await bridge.getAppInfo()
    if (!appInfoResult.ok) throw new Error(appInfoResult.error.message)
    const bootstrapResult = await bridge.getPluginBootstrap()
    if (!bootstrapResult.ok) throw new Error(bootstrapResult.error.message)
    const bootstrap = pluginBootstrapSchema.parse(bootstrapResult.value)

    pluginHost = new PluginHost({
      pictorVersion: appInfoResult.value.version,
      safeMode: bootstrap.safeMode,
    })
    const statuses = await pluginHost.start(createGuiPluginDefinitions(bootstrap))
    const workbenches = validateGuiWorkbenchContributions(
      pluginHost.getContributions(guiWorkbenchContributions),
    )
    const settingsSections = normalizeGuiSettingsSectionContributions(
      pluginHost.getContributions(guiSettingsSectionContributions),
    )
    const initialSelection = selectGuiHostView(workbenches, statuses, bootstrap.safeMode)
    if (initialSelection.kind === 'shell') await disposePluginHost()

    root.render(
      <StrictMode>
        <GuiHostView
          commandClient={bridge.commands}
          pluginPicker={bridge}
          settingsSections={settingsSections}
          guiPluginStatuses={statuses}
          workbenches={workbenches}
          safeMode={bootstrap.safeMode}
          onWorkbenchFailure={() => void disposePluginHost()}
        />
      </StrictMode>,
    )

    beforeUnload = () => {
      void stop()
    }
    window.addEventListener('beforeunload', beforeUnload, { once: true })
  } catch (error) {
    await stop()
    root.render(<FatalState error={error} />)
  }

  return { stop }
}

function validateGuiBridge(bridge: GuiBridge): void {
  if (
    !bridge.commands ||
    typeof bridge.commands.list !== 'function' ||
    typeof bridge.commands.execute !== 'function' ||
    typeof bridge.commands.cancel !== 'function' ||
    typeof bridge.commands.subscribe !== 'function' ||
    typeof bridge.pickPlugin !== 'function' ||
    typeof bridge.getAppInfo !== 'function' ||
    typeof bridge.getPluginBootstrap !== 'function'
  ) {
    throw new Error('GUI desktop bridge contract is unavailable')
  }
}

export function createGuiPluginDefinitions(
  bootstrap: PluginBootstrap,
): readonly PluginDefinition[] {
  return bootstrap.plugins.map(({ manifest, desiredState, guiEntryUrl }) => ({
    manifest,
    desiredState,
    async createModules() {
      if (!guiEntryUrl) return []
      const namespace: unknown = await import(/* @vite-ignore */ guiEntryUrl)
      if (!namespace || typeof namespace !== 'object') {
        throw new Error(`Invalid GUI Plugin entry: ${manifest.id}`)
      }
      const entrypoint = readPluginEntrypoint<GuiPluginContext>(
        namespace as Record<string, unknown>,
      )
      return entrypoint({ process: 'gui', pluginId: manifest.id })
    },
  }))
}

function FatalState({ error }: { error: unknown }): React.JSX.Element {
  return (
    <main className="pictor-host-fatal">
      <h1>无法启动 Pictor</h1>
      <p>{sanitizeGuiDiagnostic(error, 'GUI Host 无法建立')}</p>
    </main>
  )
}
