// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { WebSessionAuth } from './auth.js'

describe('WebSessionAuth', () => {
  it('exchanges the launch token only once', () => {
    const tokens = ['launch-token', 'session-token']
    const auth = new WebSessionAuth({ createToken: () => tokens.shift()! })

    expect(auth.consumeLaunchToken('launch-token')).toBe(true)
    expect(auth.consumeLaunchToken('launch-token')).toBe(false)
  })

  it('authenticates only the exact session cookie', () => {
    const tokens = ['launch-token', 'session-token']
    const auth = new WebSessionAuth({ createToken: () => tokens.shift()! })

    expect(auth.authenticate('other=value; pictor_session=session-token')).toBe(true)
    expect(auth.authenticate('pictor_session=wrong')).toBe(false)
    expect(auth.authenticate(undefined)).toBe(false)
    expect(auth.sessionCookie()).toContain('HttpOnly; SameSite=Strict')
  })
})
