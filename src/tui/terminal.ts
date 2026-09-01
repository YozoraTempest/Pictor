import process from 'node:process'

import type { TuiTerminal } from './contract.js'

/**
 * Terminal lifecycle owned by the Pictor TUI Host.
 *
 * Pi's 0.84.1 InteractiveMode still creates its own ProcessTerminal. This
 * adapter deliberately does not put stdin in raw mode; it owns diagnostics and
 * lifecycle bookkeeping while the Pi Runtime Plugin owns Pi's renderer until a
 * future public terminal injection seam is available.
 */
export class ProcessTuiTerminal implements TuiTerminal {
  private inputHandler: ((data: string) => void) | null = null
  private resizeHandler: (() => void) | null = null

  get columns(): number {
    return process.stdout.columns ?? 80
  }

  get rows(): number {
    return process.stdout.rows ?? 24
  }

  start(onInput: (data: string) => void, onResize: () => void): void {
    this.inputHandler = onInput
    this.resizeHandler = onResize
  }

  stop(): void {
    this.inputHandler = null
    this.resizeHandler = null
  }

  write(data: string): void {
    process.stdout.write(data)
  }

  /** Test/support seam for host-owned diagnostics without touching real stdin. */
  dispatchInput(data: string): void {
    this.inputHandler?.(data)
  }

  /** Test/support seam for host-owned resize notifications. */
  dispatchResize(): void {
    this.resizeHandler?.()
  }
}

export function createProcessTuiTerminal(): ProcessTuiTerminal {
  return new ProcessTuiTerminal()
}
