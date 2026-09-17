import { describe, expect, it } from 'vitest'

import { webClientMessageSchema, webServerMessageSchema } from './web-protocol.js'

const executionId = '11111111-1111-4111-8111-111111111111'

describe('Web protocol', () => {
  it('accepts command replay requests', () => {
    expect(webClientMessageSchema.parse({ type: 'command.replay', executionId })).toEqual({
      type: 'command.replay',
      executionId,
    })
  })

  it('rejects unknown browser messages', () => {
    expect(() => webClientMessageSchema.parse({ type: 'module.invoke' })).toThrow()
  })

  it('validates connection generations', () => {
    expect(
      webServerMessageSchema.parse({
        type: 'connection.ready',
        generation: '22222222-2222-4222-8222-222222222222',
      }),
    ).toMatchObject({ type: 'connection.ready' })
  })
})
