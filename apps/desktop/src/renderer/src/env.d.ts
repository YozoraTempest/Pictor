import type { PictorBridge } from '../../shared/bridge.js'

declare global {
  interface Window {
    pictor: PictorBridge
  }
}

export {}
