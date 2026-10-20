import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadHistoryPage, projectSessionFile } from './history.js'

function fixture(): string {
  const directory = mkdtempSync(join(tmpdir(), 'pictor-history-'))
  const path = join(directory, 'session.jsonl')

  const lines = [
    { type: 'session', id: 's1' },
    {
      type: 'message',
      timestamp: 1,
      message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    },
    {
      type: 'message',
      timestamp: 2,
      message: { role: 'assistant', content: [{ type: 'text', text: 'hi there' }] },
    },
    {
      type: 'message',
      timestamp: 3,
      message: {
        role: 'toolResult',
        toolName: 'read',
        isError: false,
        content: [{ type: 'text', text: 'file contents' }],
      },
    },
    { type: 'message', timestamp: 4, message: { role: 'assistant', content: [] } },
    { type: 'message', timestamp: 5, message: { role: 'user', content: 'plain string' } },
  ]

  writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`)
  return path
}

describe('projectSessionFile', () => {
  it('projects user, assistant and tool messages', async () => {
    const path = fixture()
    const messages = await projectSessionFile(path)

    expect(messages.map((message) => [message.role, message.text])).toEqual([
      ['user', 'hello'],
      ['assistant', 'hi there'],
      ['tool', 'file contents'],
      ['user', 'plain string'],
    ])
    expect(messages[2]?.toolName).toBe('read')
  })

  it('returns an empty projection for a missing file', async () => {
    await expect(projectSessionFile('/missing/session.jsonl')).resolves.toEqual([])
  })
})

describe('loadHistoryPage', () => {
  it('loads the newest page first', async () => {
    const path = fixture()
    const page = await loadHistoryPage(path, 2, 0)

    expect(page.messages.map((message) => message.text)).toEqual(['file contents', 'plain string'])
    expect(page.nextOffset).toBe(2)
    expect(page.hasMore).toBe(true)
  })

  it('loads older pages and reports the end', async () => {
    const path = fixture()

    const second = await loadHistoryPage(path, 2, 2)
    expect(second.messages.map((message) => message.text)).toEqual(['hello', 'hi there'])
    expect(second.hasMore).toBe(false)

    const third = await loadHistoryPage(path, 2, 4)
    expect(third.messages).toEqual([])
    expect(third.hasMore).toBe(false)
  })
})

describe('guard denials in the JSONL', () => {
  function blockedFixture(reason: string): string {
    const directory = mkdtempSync(join(tmpdir(), 'pictor-history-blocked-'))
    const path = join(directory, 'session.jsonl')
    const lines = [
      {
        type: 'message',
        timestamp: 1,
        message: {
          role: 'toolResult',
          toolName: 'bash',
          isError: true,
          content: [{ type: 'text', text: `[pictor:blocked] ${reason}` }],
        },
      },
      {
        type: 'message',
        timestamp: 2,
        message: {
          role: 'toolResult',
          toolName: 'read',
          isError: true,
          content: [{ type: 'text', text: 'ENOENT: no such file' }],
        },
      },
    ]

    writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`)
    return path
  }

  it('marks a marked reason as blocked and strips the marker', async () => {
    const messages = await projectSessionFile(blockedFixture('bash 被 guard 拦截'))

    expect(messages[0]).toMatchObject({
      role: 'tool',
      toolName: 'bash',
      blocked: true,
      isError: true,
      text: 'bash 被 guard 拦截',
    })
  })

  it('leaves an ordinary tool failure untouched', async () => {
    const messages = await projectSessionFile(blockedFixture('bash 被 guard 拦截'))

    expect(messages[1]?.blocked).toBeUndefined()
    expect(messages[1]?.text).toBe('ENOENT: no such file')
  })
})
