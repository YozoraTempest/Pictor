import type { ModuleTransport } from '../kernel/contract'
import type { PictorBridge, PlatformFilePicker } from '../shared/desktop-bridge'

declare global {
  interface Window {
    pictor: PictorBridge
    pictorModules: ModuleTransport
    pictorDesktop?: PlatformFilePicker
  }
}

export {}
