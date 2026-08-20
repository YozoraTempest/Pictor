// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { projectPiSessionJsonl } from './pi-session-projection.js'

const timestamp = '2026-08-20T00:00:00.000Z'
const resultTimestamp = '2026-08-20T00:00:01.000Z'

function jsonl(entries: unknown[]): string {
  return `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`
}

describe('Pi Session Projection', () => {
  it('projects the current Pi branch into stable messages, runs, and tools', () => {
    const content = jsonl([
      { type: 'session', version: 3, id: 'pi-session', timestamp, cwd: '/project' },
      {
        type: 'message',
        id: 'user-1',
        parentId: null,
        timestamp,
        message: { role: 'user', content: [{ type: 'text', text: 'Change a file' }] },
      },
      {
        type: 'message',
        id: 'assistant-tool',
        parentId: 'user-1',
        timestamp,
        message: {
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              id: 'call-1',
              name: 'pictor_write',
              arguments: { path: 'changed.txt', content: 'done' },
            },
          ],
          stopReason: 'toolUse',
          usage: {
            input: 10,
            output: 5,
            cacheRead: 2,
            cacheWrite: 1,
            totalTokens: 18,
            cost: { input: 0.5, output: 0.75, cacheRead: 0, cacheWrite: 0, total: 1.25 },
          },
        },
      },
      {
        type: 'message',
        id: 'tool-result',
        parentId: 'assistant-tool',
        timestamp: resultTimestamp,
        message: {
          role: 'toolResult',
          toolCallId: 'call-1',
          toolName: 'pictor_write',
          content: [{ type: 'text', text: 'written' }],
          isError: false,
        },
      },
      {
        type: 'message',
        id: 'assistant-final',
        parentId: 'tool-result',
        timestamp,
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Completed' }],
          stopReason: 'stop',
          usage: {
            input: 20,
            output: 8,
            cacheRead: 3,
            cacheWrite: 0,
            totalTokens: 31,
            cost: { input: 1, output: 1.5, cacheRead: 0, cacheWrite: 0, total: 2.5 },
          },
        },
      },
    ])

    const first = projectPiSessionJsonl(content)
    const second = projectPiSessionJsonl(content)

    expect(first).toEqual(second)
    expect(first.messages.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: 'user', content: 'Change a file' },
      { role: 'assistant', content: '' },
      { role: 'assistant', content: 'Completed' },
    ])
    expect(first.runs).toHaveLength(2)
    expect(first.runs[0]?.toolEvents[0]).toMatchObject({
      callId: 'call-1',
      kind: 'write',
      path: 'changed.txt',
      status: 'completed',
      output: 'written',
    })
    expect(first.runs[0]?.updatedAt).toBe(resultTimestamp)
    expect(first.usage).toEqual({
      tokens: { input: 30, output: 13, cacheRead: 5, cacheWrite: 1, total: 49 },
      cost: 3.75,
      context: null,
    })
  })

  it('follows the latest leaf branch and preserves compaction summaries', () => {
    const projection = projectPiSessionJsonl(
      jsonl([
        { type: 'session', version: 3, id: 'pi-session', timestamp, cwd: '/project' },
        {
          type: 'message',
          id: 'root',
          parentId: null,
          timestamp,
          message: { role: 'user', content: 'Root' },
        },
        {
          type: 'message',
          id: 'old-branch',
          parentId: 'root',
          timestamp,
          message: { role: 'assistant', content: 'Old branch', stopReason: 'stop' },
        },
        {
          type: 'compaction',
          id: 'compact',
          parentId: 'root',
          timestamp,
          summary: 'Current branch summary',
        },
      ]),
    )

    expect(projection.messages.map((message) => message.content)).toEqual([
      'Root',
      'Compaction summary\n\nCurrent branch summary',
    ])
  })

  it('uses the same readable Runtime failure classification as live events', () => {
    const projection = projectPiSessionJsonl(
      jsonl([
        { type: 'session', version: 3, id: 'pi-session', timestamp, cwd: '/project' },
        {
          type: 'message',
          id: 'failed-assistant',
          parentId: null,
          timestamp,
          message: {
            role: 'assistant',
            content: [],
            stopReason: 'error',
            errorMessage: 'HTTP 401 Invalid API key',
          },
        },
      ]),
    )

    expect(projection.runs[0]).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('模型认证失败'),
    })
  })
})
