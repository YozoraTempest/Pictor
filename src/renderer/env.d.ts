import type { PictorBridge } from '../shared/desktop-bridge'

declare global {
  interface Window {
    pictor: PictorBridge
  }
}

export {}
