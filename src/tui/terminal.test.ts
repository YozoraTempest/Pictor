// @vitest-environment node

import { expect, it, vi } from 'vitest'

import type { TuiTerminal } from './contract.js'

class FakeTerminal implements TuiTerminal {
  columns = 80
  rows = 24
  readonly output: string[] = []
  private inputHandler: ((data: string) => void) | undefined
  private resizeHandler: (() => void) | undefined
  readonly starts = vi.fn()
  readonly stops = vi.fn()

  start(onInput: (data: string) => void, onResize: () => void): void {
    this.starts()
    this.inputHandler = onInput
    this.resizeHandler = onResize
  }

  stop(): void {
    this.stops()
    this.inputHandler = undefined
    this.resizeHandler = undefined
  }

  write(data: string): void {
    this.output.push(data)
  }

  input(data: string): void {
    this.inputHandler?.(data)
  }

  resize(columns: number, rows: number): void {
    this.columns = columns
    this.rows = rows
    this.resizeHandler?.()
  }
}

it('provides deterministic fake terminal input, output, resize, and cleanup', () => {
  const terminal = new FakeTerminal()
  const input = vi.fn()
  const resize = vi.fn()
  terminal.start(input, resize)
  terminal.input('hello')
  terminal.resize(120, 40)
  terminal.write('rendered\n')
  terminal.stop()
  terminal.input('ignored')

  expect(input).toHaveBeenCalledWith('hello')
  expect(resize).toHaveBeenCalledOnce()
  expect(terminal.columns).toBe(120)
  expect(terminal.rows).toBe(40)
  expect(terminal.output).toEqual(['rendered\n'])
  expect(terminal.starts).toHaveBeenCalledOnce()
  expect(terminal.stops).toHaveBeenCalledOnce()
})
