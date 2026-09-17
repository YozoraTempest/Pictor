import * as React from 'react'
import * as jsxDevRuntime from 'react/jsx-dev-runtime'
import * as jsxRuntime from 'react/jsx-runtime'

import { startGui } from '../gui/index.js'
import type { ModuleTransport } from '../kernel/contract.js'
import type { PictorBridge } from '../shared/desktop-bridge.js'
import { createWebFrontendAdapters } from '../web-client/bridge.js'
import '../web-client/file-picker.css'
import '../gui/styles.css'

const root = document.getElementById('root')

if (!root) {
  throw new Error('Missing renderer root element')
}

Object.assign(globalThis, {
  __PICTOR_REACT__: React,
  __PICTOR_JSX_RUNTIME__: jsxRuntime,
  __PICTOR_JSX_DEV_RUNTIME__: jsxDevRuntime,
})

void startRenderer(root)

async function startRenderer(rootElement: HTMLElement): Promise<void> {
  const desktopBridge = readDesktopBridge()
  if (desktopBridge) {
    await startGui(rootElement, desktopBridge.bridge)
    return
  }

  const web = await createWebFrontendAdapters()
  Object.assign(window, {
    pictor: web.bridge,
    pictorModules: web.modules,
  })
  const gui = await startGui(rootElement, web.bridge)
  window.addEventListener(
    'beforeunload',
    () => {
      void gui.stop()
      web.stop()
    },
    { once: true },
  )
}

function readDesktopBridge(): { bridge: PictorBridge; modules: ModuleTransport } | null {
  const bridge = Reflect.get(window, 'pictor') as PictorBridge | undefined
  const modules = Reflect.get(window, 'pictorModules') as ModuleTransport | undefined
  return bridge && modules ? { bridge, modules } : null
}
