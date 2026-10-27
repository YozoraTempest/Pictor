import { DSH } from './wire.js'
import { describe, expect, it } from 'vitest'

import type { SessionWireEvent } from '@vulonlok/harness-dsh'

import { sessionTitleOf, shouldAdoptTitle } from './harness-title.js'

function event(data: unknown): SessionWireEvent {
  return { type: DSH.session.title, seq: 1, time: 0, data } as SessionWireEvent
}

describe('sessionTitleOf', () => {
  it('reads the title the runtime recorded', () => {
    expect(sessionTitleOf(event({ title: '排查构建失败', source: { kind: 'fallback' } }))).toBe(
      '排查构建失败',
    )
  })

  it('prefers whichever title arrived last, because the caller applies each in order', () => {
    // The runtime writes a fallback first and an llm-generated name afterwards.
    expect(sessionTitleOf(event({ title: '用 write 工具把 hello 写到' }))).toBe(
      '用 write 工具把 hello 写到',
    )
    expect(sessionTitleOf(event({ title: '用 write 工具写入探测文件' }))).toBe(
      '用 write 工具写入探测文件',
    )
  })

  it('ignores every other event type', () => {
    expect(
      sessionTitleOf({ type: 'turn/start', seq: 2, time: 0, data: {} } as SessionWireEvent),
    ).toBe(null)
  })

  it('refuses an empty or missing title instead of clearing the row', () => {
    expect(sessionTitleOf(event({ title: '   ' }))).toBe(null)
    expect(sessionTitleOf(event({}))).toBe(null)
    expect(sessionTitleOf(event(null))).toBe(null)
  })
})

describe('shouldAdoptTitle', () => {
  const none = new Set<string>()

  it('replaces the placeholder Pictor writes at creation', () => {
    expect(shouldAdoptTitle('新会话 09:41', '排查构建失败', none)).toBe(true)
  })

  it('replaces a title the runtime produced earlier with a better one', () => {
    // The runtime writes a truncated prompt first, the generated name second.
    const known = new Set(['用一句话说明 HTTP 缓存里 ETag'])
    expect(
      shouldAdoptTitle('用一句话说明 HTTP 缓存里 ETag', 'ETag 与 Last-Modified 区别', known),
    ).toBe(true)
  })

  it('never replaces a name a person typed', () => {
    // `runtimeTitles` only ever holds strings the runtime produced, so a name a
    // person typed is never in it — and that is what keeps it safe.
    const producedByRuntime = new Set(['用一句话说明 HTTP 缓存里 ETag'])
    expect(shouldAdoptTitle('我的排查笔记', 'Some Generated Title', producedByRuntime)).toBe(false)
  })

  it('does nothing when the name already matches', () => {
    expect(shouldAdoptTitle('排查构建失败', '排查构建失败', none)).toBe(false)
  })
})
