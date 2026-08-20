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

  it('projects any selected entry while preserving the active Session Tree leaf', () => {
    const content = jsonl([
      { type: 'session', version: 3, id: 'pi-session', timestamp, cwd: '/project' },
      {
        type: 'message',
        id: 'root-user',
        parentId: null,
        timestamp,
        message: { role: 'user', content: 'Root task' },
      },
      {
        type: 'message',
        id: 'old-branch',
        parentId: 'root-user',
        timestamp: '2026-08-20T00:00:01.000Z',
        message: { role: 'assistant', content: 'Historical answer', stopReason: 'stop' },
      },
      {
        type: 'message',
        id: 'active-branch',
        parentId: 'root-user',
        timestamp: '2026-08-20T00:00:02.000Z',
        message: { role: 'assistant', content: 'Active answer', stopReason: 'stop' },
      },
      {
        type: 'label',
        id: 'active-label',
        parentId: 'active-branch',
        timestamp: '2026-08-20T00:00:03.000Z',
        targetId: 'old-branch',
        label: 'checkpoint',
      },
    ])

    const projection = projectPiSessionJsonl(content, 'old-branch')

    expect(projection.messages.map((message) => message.content)).toEqual([
      'Root task',
      'Historical answer',
    ])
    expect(projection.tree).toMatchObject({
      activeLeafId: 'active-label',
      selectedEntryId: 'old-branch',
    })
    expect(projection.tree.nodes).toEqual([
      expect.objectContaining({
        id: 'root-user',
        parentId: null,
        depth: 0,
        childCount: 2,
        isActivePath: true,
      }),
      expect.objectContaining({
        id: 'old-branch',
        parentId: 'root-user',
        depth: 1,
        label: 'checkpoint',
        isSelected: true,
        isActivePath: false,
      }),
      expect.objectContaining({
        id: 'active-branch',
        parentId: 'root-user',
        depth: 1,
        isActivePath: true,
      }),
      expect.objectContaining({
        id: 'active-label',
        parentId: 'active-branch',
        depth: 2,
        isActiveLeaf: true,
      }),
    ])
  })

  it('projects a persisted active leaf independently from the last JSONL entry', () => {
    const content = jsonl([
      { type: 'session', version: 3, id: 'pi-session', timestamp, cwd: '/project' },
      {
        type: 'message',
        id: 'root-user',
        parentId: null,
        timestamp,
        message: { role: 'user', content: 'Root task' },
      },
      {
        type: 'message',
        id: 'historical-answer',
        parentId: 'root-user',
        timestamp,
        message: { role: 'assistant', content: 'Historical answer', stopReason: 'stop' },
      },
      {
        type: 'message',
        id: 'last-answer',
        parentId: 'root-user',
        timestamp,
        message: { role: 'assistant', content: 'Last answer', stopReason: 'stop' },
      },
    ])

    const projection = projectPiSessionJsonl(content, null, 'historical-answer')

    expect(projection.messages.map((message) => message.content)).toEqual([
      'Root task',
      'Historical answer',
    ])
    expect(projection.tree).toMatchObject({
      activeLeafId: 'historical-answer',
      selectedEntryId: 'historical-answer',
    })
  })

  it('projects the active branch Model and Thinking state', () => {
    const projection = projectPiSessionJsonl(
      jsonl([
        { type: 'session', version: 3, id: 'pi-session', timestamp, cwd: '/project' },
        {
          type: 'model_change',
          id: 'model-entry',
          parentId: null,
          timestamp,
          provider: 'pictor-openai-compatible',
          modelId: 'model-a',
        },
        {
          type: 'thinking_level_change',
          id: 'thinking-entry',
          parentId: 'model-entry',
          timestamp,
          thinkingLevel: 'high',
        },
      ]),
    )

    expect(projection.runtimeState).toEqual({
      modelId: 'model-a',
      modelProvider: 'pictor-openai-compatible',
      thinkingLevel: 'high',
    })
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
