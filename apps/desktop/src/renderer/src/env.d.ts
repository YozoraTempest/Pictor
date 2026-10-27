import type { PictorBridge } from '@vulonlok/harness/main/bridge'

declare global {
  interface Window {
    pictor: PictorBridge
  }
}

export {}
