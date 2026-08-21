import { StrictMode } from 'react'
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import * as jsxDevRuntime from 'react/jsx-dev-runtime'
import * as jsxRuntime from 'react/jsx-runtime'

import { settingsSectionContributions } from '../modules/shell/settings'
import { shellApplicationContributions } from '../modules/shell/application'
import { readPluginEntrypoint, type RendererPluginContext } from '../plugin/entry'
import { PluginHost, type PluginDefinition } from '../plugin/host'
import { CoreShell } from './CoreShell'
import './styles.css'

const root = document.getElementById('root')

if (!root) {
  throw new Error('Missing renderer root element')
}

let activePluginHost: PluginHost | null = null

Object.assign(globalThis, {
  __PICTOR_REACT__: React,
  __PICTOR_JSX_RUNTIME__: jsxRuntime,
  __PICTOR_JSX_DEV_RUNTIME__: jsxDevRuntime,
})

void (async () => {
  const appInfo = await window.pictor.getAppInfo()
  if (!appInfo.ok) throw new Error(appInfo.error.message)
  const bootstrap = await window.pictor.getPluginBootstrap()
  if (!bootstrap.ok) throw new Error(bootstrap.error.message)

  const definitions: PluginDefinition[] = bootstrap.value.plugins.map(
    ({ manifest, desiredState, rendererEntryUrl }) => ({
      manifest,
      desiredState,
      async createModules() {
        if (!rendererEntryUrl) return []
        const namespace: unknown = await import(/* @vite-ignore */ rendererEntryUrl)
        if (!namespace || typeof namespace !== 'object') {
          throw new Error(`Invalid Renderer Plugin entry: ${manifest.id}`)
        }
        const entrypoint = readPluginEntrypoint<RendererPluginContext>(
          namespace as Record<string, unknown>,
        )
        return entrypoint({ process: 'renderer', pluginId: manifest.id })
      },
    }),
  )

  const host = new PluginHost({
    pictorVersion: appInfo.value.version,
    safeMode: bootstrap.value.safeMode,
  })
  const rendererPluginStatuses = await host.start(definitions)
  activePluginHost = host
  const applications = host.getContributions(shellApplicationContributions)
  if (applications.length > 1) throw new Error('Multiple Shell applications are active')
  createRoot(root).render(
    <StrictMode>
      <CoreShell
        application={applications[0] ?? null}
        settingsSections={host.getContributions(settingsSectionContributions)}
        rendererPluginStatuses={rendererPluginStatuses}
      />
    </StrictMode>,
  )
})().catch((error: unknown) => {
  createRoot(root).render(
    <main className="fatal-state">
      <h1>无法启动 Pictor</h1>
      <p>{error instanceof Error ? error.message : String(error)}</p>
    </main>,
  )
})

window.addEventListener('beforeunload', () => void activePluginHost?.stop(), { once: true })
