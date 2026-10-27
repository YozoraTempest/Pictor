import type { JsonValue } from '@vulonlok/shared'

export interface RpcRequestFrame {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: JsonValue
}

export interface RpcErrorBody {
  code: number
  message: string
}

export interface RpcResponseFrame {
  jsonrpc: '2.0'
  id: number | null
  result?: JsonValue
  error?: RpcErrorBody
}

/** A JSON-RPC failure surfaced as an Error so callers can `try/catch`. */
export class RpcError extends Error {
  readonly code: number

  constructor(body: RpcErrorBody) {
    super(body.message)
    this.name = 'RpcError'
    this.code = body.code
  }
}

export function encodeRequest(frame: RpcRequestFrame): string {
  return JSON.stringify(frame)
}

export function parseResponse(line: string): RpcResponseFrame {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch (error) {
    throw new RpcError({
      code: -32700,
      message: `malformed response: ${(error as Error).message}`,
    })
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new RpcError({ code: -32700, message: 'response is not an object' })
  }

  const frame = parsed as Partial<RpcResponseFrame>
  if (frame.jsonrpc !== '2.0') {
    throw new RpcError({ code: -32700, message: 'response is not JSON-RPC 2.0' })
  }
  if (frame.id !== null && typeof frame.id !== 'number') {
    throw new RpcError({ code: -32700, message: 'response id must be a number or null' })
  }
  if (frame.error === undefined && frame.result === undefined) {
    throw new RpcError({ code: -32700, message: 'response has neither result nor error' })
  }

  return frame as RpcResponseFrame
}

/**
 * Splits an arbitrarily chunked stream into complete NDJSON lines.
 *
 * A transport may deliver half a frame; the buffer keeps the remainder until
 * the next chunk arrives.
 */
export class LineBuffer {
  #remainder = ''

  push(chunk: string): string[] {
    const combined = this.#remainder + chunk
    const lines = combined.split('\n')
    this.#remainder = lines.pop() ?? ''

    return lines.map((line) => line.replace(/\r$/, '')).filter((line) => line.trim().length > 0)
  }

  flush(): string | null {
    const remainder = this.#remainder
    this.#remainder = ''
    return remainder.trim().length > 0 ? remainder : null
  }
}
