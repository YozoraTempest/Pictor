import type { PictorBridge } from '../shared/contracts'

declare global {
  interface Window {
    pictor: PictorBridge
  }
}

export {}
