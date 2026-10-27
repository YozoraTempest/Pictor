import { describe, expect, it } from 'vitest'

import { FRAME_MESSAGE_LIMITS, frameAnswer, frameInit, readFrameMessage } from './frame-protocol.js'

/**
 * This parser is the boundary between plugin code running in a frame and the window that
 * hosts it, so the cases that matter are the refusals. Everything a frame sends arrives as
 * `postMessage` data: no types, no trust, and no way to tell a typo from an attack.
 */
describe('readFrameMessage', () => {
  it('reads the two messages a frame may send', () => {
    expect(readFrameMessage({ __pictor: true, type: 'ready' })).toEqual({ type: 'ready' })
    expect(
      readFrameMessage({ __pictor: true, type: 'request', id: 3, action: 'press', value: 'main' }),
    ).toEqual({ type: 'request', id: 3, action: 'press', value: 'main' })
  })

  it('reads nothing from a message that does not name this channel', () => {
    // The frame shares one message stream with everything the plugin's page does, so the
    // marker is what keeps its own messages from being answered as requests.
    expect(readFrameMessage({ type: 'ready' })).toBeNull()
    expect(readFrameMessage({ __pictor: 'yes', type: 'ready' })).toBeNull()
    expect(readFrameMessage(null)).toBeNull()
    expect(readFrameMessage('ready')).toBeNull()
    expect(readFrameMessage([{ __pictor: true, type: 'ready' }])).toBeNull()
  })

  it('refuses a request with no usable id or action', () => {
    const base = { __pictor: true, type: 'request', action: 'press' }

    expect(readFrameMessage({ ...base, id: '1' })).toBeNull()
    expect(readFrameMessage({ ...base, id: -1 })).toBeNull()
    expect(readFrameMessage({ ...base, id: 1.5 })).toBeNull()
    expect(readFrameMessage({ ...base, id: 1, action: '' })).toBeNull()
    expect(readFrameMessage({ __pictor: true, type: 'request', id: 1 })).toBeNull()
  })

  it('refuses a request that carries something other than text', () => {
    const base = { __pictor: true, type: 'request', id: 1, action: 'press' }

    expect(readFrameMessage({ ...base, value: { nested: true } })).toBeNull()
    expect(readFrameMessage({ ...base, value: 12 })).toBeNull()
  })

  it('bounds what one message may carry', () => {
    const base = { __pictor: true, type: 'request', id: 1 }
    const long = (length: number): string => 'x'.repeat(length)

    expect(
      readFrameMessage({
        ...base,
        action: long(FRAME_MESSAGE_LIMITS.action + 1),
      }),
    ).toBeNull()
    expect(
      readFrameMessage({
        ...base,
        action: 'press',
        value: long(FRAME_MESSAGE_LIMITS.value + 1),
      }),
    ).toBeNull()
    expect(
      readFrameMessage({
        ...base,
        action: 'press',
        value: long(FRAME_MESSAGE_LIMITS.value),
      }),
    ).toMatchObject({ type: 'request' })
  })
})

describe('messages the window sends', () => {
  it('marks every one so a frame can tell them from its own', () => {
    // The values are whatever the renderer read from its tokens; this only carries them.
    const context = { sessionId: null, theme: { accent: 'accent' } }
    expect(frameInit(context)).toEqual({ __pictor: true, type: 'init', context })
    expect(frameAnswer(4, { ok: true, data: { presses: 2 } })).toEqual({
      __pictor: true,
      type: 'answer',
      id: 4,
      ok: true,
      data: { presses: 2 },
    })
    // A failure travels in the plugin's own words, not as a code the frame would guess at.
    expect(frameAnswer(5, { ok: false, error: '不认识的消息：x' })).toEqual({
      __pictor: true,
      type: 'answer',
      id: 5,
      ok: false,
      error: '不认识的消息：x',
    })
  })
})
