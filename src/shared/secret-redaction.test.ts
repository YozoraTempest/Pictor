// @vitest-environment node

import { describe, expect, it } from 'vitest'

import type { RuntimeEvent, SessionRecord } from './contracts.js'
import { REDACTED_SECRET, createSecretRedactor } from './secret-redaction.js'

const runId = '01234567-89ab-4def-8123-456789abcdef'
const sessionId = '11234567-89ab-4def-8123-456789abcdef'
const messageId = '21234567-89ab-4def-8123-456789abcdef'
const now = '2026-08-11T00:00:00.000Z'

function createSession(secret: string): SessionRecord {
  return {
    schemaVersion: 1,
    id: sessionId,
    projectId: runId,
    title: `title ${secret}`,
    messages: [
      {
        id: messageId,
        role: 'assistant',
        content: `message ${secret}`,
        status: 'completed',
        createdAt: now,
        updatedAt: now,
      },
    ],
    runs: [
      {
        id: runId,
        status: 'running',
        error: `error ${secret}`,
        toolEvents: [
          {
            id: messageId,
            callId: 'call-id',
            kind: 'command',
            label: `label ${secret}`,
            path: `path/${secret}`,
            command: {
              command: `echo ${secret}`,
              cwd: `cwd/${secret}`,
              purpose: `purpose ${secret}`,
              approval: 'pending',
            },
            status: 'running',
            output: `output ${secret}`,
            createdAt: now,
            updatedAt: now,
          },
        ],
        createdAt: now,
        updatedAt: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
  }
}

describe('structure-aware secret redaction', () => {
  it.each(['a', 'id', 'running'])('preserves Session control fields for short key %s', (secret) => {
    const original = createSession(secret)
    const redacted = createSecretRedactor([secret]).redactSession(original)

    expect(redacted).toMatchObject({
      schemaVersion: 1,
      id: sessionId,
      projectId: runId,
      createdAt: now,
      updatedAt: now,
      messages: [{ id: messageId, role: 'assistant', status: 'completed' }],
      runs: [
        {
          id: runId,
          status: 'running',
          toolEvents: [
            {
              id: messageId,
              callId: 'call-id',
              kind: 'command',
              status: 'running',
              command: { approval: 'pending' },
            },
          ],
        },
      ],
    })
    expect(redacted.messages[0]?.content).toContain(REDACTED_SECRET)
    expect(redacted.runs[0]?.error).toContain(REDACTED_SECRET)
    expect(redacted.runs[0]?.toolEvents[0]?.output).toContain(REDACTED_SECRET)
    expect(original.messages[0]?.content).toContain(secret)
  })

  it.each(['a', 'id', 'running'])(
    'preserves RuntimeEvent discriminants and identifiers for short key %s',
    (secret) => {
      const event: RuntimeEvent = {
        type: 'run.stateChanged',
        runId,
        sessionId,
        at: now,
        status: 'running',
        error: `runtime error ${secret}`,
      }
      const redacted = createSecretRedactor([secret]).redactRuntimeEvent(event)

      expect(redacted).toEqual({
        ...event,
        error: createSecretRedactor([secret]).redactText(event.error!),
      })
      expect(redacted.type).toBe('run.stateChanged')
      expect(redacted.runId).toBe(runId)
      expect(redacted.sessionId).toBe(sessionId)
      if (redacted.type !== 'run.stateChanged') throw new Error('Unexpected event type')
      expect(redacted.status).toBe('running')
    },
  )

  it.each(['custom', 'branch_summary', 'custom_message', 'toolResult'] as const)(
    'redacts every string in %s arbitrary payloads without changing keys',
    (kind) => {
      const secret = ['arbitrary', 'payload', 'credential'].join('-')
      const payload = {
        id: secret,
        status: secret,
        model: secret,
        type: secret,
        role: secret,
        name: secret,
        [secret]: secret,
      }
      const structural = { id: 'entry-id', parentId: 'parent-id', timestamp: now }
      const entry =
        kind === 'custom'
          ? { type: kind, ...structural, customType: 'provider-event', data: payload }
          : kind === 'branch_summary'
            ? { type: kind, ...structural, summary: `summary ${secret}`, details: payload }
            : kind === 'custom_message'
              ? {
                  type: kind,
                  ...structural,
                  customType: 'provider-message',
                  content: `content ${secret}`,
                  details: payload,
                }
              : {
                  type: 'message',
                  ...structural,
                  message: {
                    role: kind,
                    toolCallId: 'call-id',
                    toolName: 'pictor_read',
                    content: [{ type: 'text', text: `result ${secret}` }],
                    details: payload,
                    isError: true,
                    timestamp: Date.parse(now),
                  },
                }

      const redacted = createSecretRedactor([secret]).redactPiEntry(entry) as Record<
        string,
        unknown
      >
      const arbitrary =
        kind === 'custom'
          ? (redacted.data as Record<string, string>)
          : kind === 'toolResult'
            ? ((redacted.message as Record<string, unknown>).details as Record<string, string>)
            : (redacted.details as Record<string, string>)

      expect(arbitrary).toEqual({
        id: REDACTED_SECRET,
        status: REDACTED_SECRET,
        model: REDACTED_SECRET,
        type: REDACTED_SECRET,
        role: REDACTED_SECRET,
        name: REDACTED_SECRET,
        [secret]: REDACTED_SECRET,
      })
      expect(redacted).toMatchObject({
        type: kind === 'toolResult' ? 'message' : kind,
        ...structural,
      })
    },
  )

  it.each(['a', 'id', 'running'])(
    'preserves Pi JSONL structure while redacting text and tool payloads for short key %s',
    (secret) => {
      const entry = {
        type: 'message',
        id: 'entry-id',
        parentId: 'parent-id',
        timestamp: now,
        message: {
          role: 'assistant',
          status: 'running',
          content: [
            { type: 'text', text: `assistant ${secret}` },
            {
              type: 'toolCall',
              id: 'tool-id',
              name: 'pictor_write',
              arguments: {
                path: `path/${secret}`,
                content: `content ${secret}`,
                id: secret,
                status: secret,
                model: secret,
                type: secret,
                role: secret,
                name: secret,
              },
            },
          ],
          provider: 'provider-id',
          model: 'model-id',
          stopReason: 'toolUse',
        },
      }
      const redacted = createSecretRedactor([secret]).redactPiEntry(entry) as typeof entry

      expect(redacted).toMatchObject({
        type: 'message',
        id: 'entry-id',
        parentId: 'parent-id',
        timestamp: now,
        message: {
          role: 'assistant',
          status: 'running',
          provider: 'provider-id',
          model: 'model-id',
          stopReason: 'toolUse',
          content: [
            { type: 'text', text: expect.stringContaining(REDACTED_SECRET) },
            {
              type: 'toolCall',
              id: 'tool-id',
              name: 'pictor_write',
              arguments: {
                path: expect.stringContaining(REDACTED_SECRET),
                content: expect.stringContaining(REDACTED_SECRET),
                id: REDACTED_SECRET,
                status: REDACTED_SECRET,
                model: REDACTED_SECRET,
                type: REDACTED_SECRET,
                role: REDACTED_SECRET,
                name: REDACTED_SECRET,
              },
            },
          ],
        },
      })
      expect(Object.keys(redacted)).toEqual(Object.keys(entry))
    },
  )

  it.each(['a', 'id', 'running'])(
    'keeps Pi control entries intact during in-place redaction for short key %s',
    (secret) => {
      const entry = {
        type: 'model_change',
        id: 'entry-id',
        parentId: null,
        timestamp: now,
        provider: 'provider-id',
        modelId: 'model-id',
      }

      const redacted = createSecretRedactor([secret]).redactPiEntryInPlace(entry)

      expect(redacted).toEqual({
        type: 'model_change',
        id: 'entry-id',
        parentId: null,
        timestamp: now,
        provider: 'provider-id',
        modelId: 'model-id',
      })
    },
  )
})
