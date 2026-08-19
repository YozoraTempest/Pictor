import type { ModuleTransport } from '../kernel/contract'
import type { PictorBridge } from '../shared/desktop-bridge'

declare global {
  interface Window {
    pictor: PictorBridge
    pictorModules: ModuleTransport
  }
}

export {}
