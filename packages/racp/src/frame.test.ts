import { describe, expect, it } from 'vitest'

import { LineBuffer, parseResponse } from './frame.js'

describe('LineBuffer', () => {
  it('emits complete lines and keeps the remainder', () => {
    const buffer = new LineBuffer()

    expect(buffer.push('{"a":1}\n{"b"')).toEqual(['{"a":1}'])
    expect(buffer.push(':2}\n')).toEqual(['{"b":2}'])
    expect(buffer.flush()).toBeNull()
  })

  it('strips carriage returns and skips blank lines', () => {
    const buffer = new LineBuffer()

    expect(buffer.push('one\r\n\r\n')).toEqual(['one'])
  })

  it('flushes a trailing frame without a newline', () => {
    const buffer = new LineBuffer()
    buffer.push('{"partial":true}')

    expect(buffer.flush()).toBe('{"partial":true}')
    expect(buffer.flush()).toBeNull()
  })
})

describe('parseResponse', () => {
  it('accepts a result frame', () => {
    expect(parseResponse('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}')).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { ok: true },
    })
  })

  it('accepts an error frame', () => {
    const frame = parseResponse(
      '{"jsonrpc":"2.0","id":2,"error":{"code":-32004,"message":"not found"}}',
    )
    expect(frame.error).toEqual({ code: -32004, message: 'not found' })
  })

  it('rejects frames without result or error', () => {
    expect(() => parseResponse('{"jsonrpc":"2.0","id":3}')).toThrow(/neither result nor error/)
  })

  it('rejects a wrong protocol version', () => {
    expect(() => parseResponse('{"jsonrpc":"1.0","id":4,"result":null}')).toThrow(/JSON-RPC 2.0/)
  })
})
