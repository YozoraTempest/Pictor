import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { ModuleKernel } from '../kernel/kernel'
import { rendererModules } from '../modules/catalog/renderer'
import { settingsSectionContributions } from '../modules/shell/settings'
import { updaterClientToken } from '../modules/updater/renderer'
import { App } from './App'
import './styles.css'

const root = document.getElementById('root')

if (!root) {
  throw new Error('Missing renderer root element')
}

const kernel = new ModuleKernel()

void kernel.start(rendererModules).then(() => {
  createRoot(root).render(
    <StrictMode>
      <App
        updater={kernel.get(updaterClientToken)}
        settingsSections={kernel.getContributions(settingsSectionContributions)}
      />
    </StrictMode>,
  )
})

window.addEventListener('beforeunload', () => void kernel.stop(), { once: true })
