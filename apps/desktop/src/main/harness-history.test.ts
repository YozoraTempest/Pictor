import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import {
  findSessionFile,
  loadHarnessHistory,
  projectHarnessEvents,
  readSessionEvents,
} from './harness-history.js'

const userMessage = (id: string, text: string, kind = 'user') => ({
  type: 'user/message',
  seq: 1,
  time: 1000,
  data: { id, source: { kind }, content: [{ type: 'text', text }] },
})

const assistantMessage = (text: string) => ({
  type: 'assistant/message',
  seq: 2,
  time: 2000,
  data: { message: { role: 'assistant', content: [{ type: 'text', text }] } },
})

describe('projectHarnessEvents', () => {
  it("keeps the user's own words and drops injected runtime context", () => {
    const messages = projectHarnessEvents([
      userMessage('m1', 'ping'),
      userMessage('ctx', 'Current runtime context. This snapshot supersedes…', 'runtime-context'),
      userMessage('reminder', '<system-reminder>skills…</system-reminder>', 'runtime-context'),
      assistantMessage('pong'),
    ])

    expect(messages.map((message) => [message.role, message.text])).toEqual([
      ['user', 'ping'],
      ['assistant', 'pong'],
    ])
  })

  it('shows one row per tool call, filled in by its result', () => {
    const messages = projectHarnessEvents([
      userMessage('m1', 'read the file'),
      {
        type: 'tool/call',
        seq: 3,
        time: 3000,
        data: { callId: 'c1', name: 'read', arguments: { path: 'a.ts' } },
      },
      {
        type: 'tool/result',
        seq: 4,
        time: 4000,
        data: { callId: 'c1', name: 'read', output: 'body' },
      },
    ])

    const tool = messages.find((message) => message.role === 'tool')
    expect(tool).toMatchObject({
      toolName: 'read',
      text: 'body',
      isError: false,
      input: { path: 'a.ts' },
    })
    expect(messages.filter((message) => message.role === 'tool')).toHaveLength(1)
  })

  it('does not repeat a user message that the inbox also logged', () => {
    const message = userMessage('m1', 'ping')
    const messages = projectHarnessEvents([message, { ...message, seq: 9 }])

    expect(messages).toHaveLength(1)
  })
})

describe('loadHarnessHistory', () => {
  it('pages from the newest message backwards, like the Pi reader', () => {
    const root = mkdtempSync(join(tmpdir(), 'pictor-history-'))
    const directory = join(root, 'sessions', '--project--', 's1')
    mkdirSync(directory, { recursive: true })

    const file = join(directory, 'session.v4.jsonl.zstd')
    const lines = [
      userMessage('m1', 'one'),
      assistantMessage('first'),
      userMessage('m2', 'two'),
      assistantMessage('second'),
    ]
      .map((event) => JSON.stringify(event))
      .join('\n')
    writeFileSync(file, zstdCompressSync(Buffer.from(lines, 'utf8')))

    expect(findSessionFile(root, 's1')).toBe(file)
    expect(readSessionEvents(file)).toHaveLength(4)

    const page = loadHarnessHistory(file, 2, 0)
    expect(page.messages.map((message) => message.text)).toEqual(['two', 'second'])
    expect(page.hasMore).toBe(true)

    const older = loadHarnessHistory(file, 2, page.nextOffset)
    expect(older.messages.map((message) => message.text)).toEqual(['one', 'first'])
    expect(older.hasMore).toBe(false)
  })

  it('prefers the newest generation when several exist', () => {
    const root = mkdtempSync(join(tmpdir(), 'pictor-history-'))
    const directory = join(root, 'sessions', '--project--', 's1')
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'session.v3.jsonl.zstd'), zstdCompressSync(Buffer.from('')))
    writeFileSync(join(directory, 'session.v4.jsonl.zstd'), zstdCompressSync(Buffer.from('')))

    expect(findSessionFile(root, 's1')).toBe(join(directory, 'session.v4.jsonl.zstd'))
  })

  it('returns an empty page when the session has no log yet', () => {
    expect(loadHarnessHistory(null, 50, 0)).toEqual({ messages: [], nextOffset: 0, hasMore: false })
  })
})
