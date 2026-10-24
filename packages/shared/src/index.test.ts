import { describe, expect, it } from 'vitest'

import { isAutoSessionTitle } from './index.js'

describe('isAutoSessionTitle', () => {
  it('recognises the placeholder Pictor writes at creation', () => {
    expect(isAutoSessionTitle('新会话 09:41')).toBe(true)
    expect(isAutoSessionTitle('新会话 00:07')).toBe(true)
  })

  it('recognises a branch placeholder', () => {
    expect(isAutoSessionTitle('新会话 09:41 · 分支')).toBe(true)
    expect(isAutoSessionTitle('新会话 09:41 · 分支 · 分支')).toBe(true)
  })

  it('treats anything a person typed as their own', () => {
    expect(isAutoSessionTitle('排查构建失败')).toBe(false)
    expect(isAutoSessionTitle('新会话 09:41 · 我改过的名字')).toBe(false)
    expect(isAutoSessionTitle('新会话')).toBe(false)
    expect(isAutoSessionTitle('')).toBe(false)
  })
})
