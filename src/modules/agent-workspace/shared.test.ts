import { expect, it, vi } from 'vitest'

import type { ModuleTransport } from '../../kernel/contract.js'
import {
  createAgentWorkspaceClient,
  defaultSessionExportFileName,
  exportSessionRequestSchema,
  importSessionRequestSchema,
} from './shared.js'

const sessionId = '11111111-1111-4111-8111-111111111111'

it('invokes and validates the Agent Workspace contract through Module transport', async () => {
  const invoke = vi.fn(async () => ({
    ok: true,
    value: {
      projects: [],
      sessions: [],
      selectedProjectId: null,
      selectedSessionId: null,
      settings: null,
      issues: [],
    },
  }))
  const transport: ModuleTransport = {
    invoke,
    onEvent: vi.fn(() => () => undefined),
  }
  const client = createAgentWorkspaceClient(transport)

  await expect(client.getSnapshot()).resolves.toMatchObject({ ok: true })
  expect(invoke).toHaveBeenCalledWith('pictor.agent-workspace', 'getSnapshot', null)
})

it('validates Runtime events at the Agent Workspace client seam', () => {
  let dispatch: ((payload: unknown) => void) | undefined
  const transport: ModuleTransport = {
    invoke: vi.fn(),
    onEvent: vi.fn((_moduleId, _event, listener) => {
      dispatch = listener
      return () => undefined
    }),
  }
  const listener = vi.fn()
  createAgentWorkspaceClient(transport).onRuntimeEvent(listener)

  dispatch?.({
    type: 'session.bound',
    runId: null,
    sessionId,
    at: new Date().toISOString(),
    piSessionId: 'pi-session',
    piSessionPath: '/sessions/session.jsonl',
  })

  expect(listener).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'session.bound', sessionId }),
  )
  expect(() => dispatch?.({ type: 'unknown' })).toThrow()
})

it('models file operations as explicit paths at the Workspace contract seam', () => {
  expect(
    importSessionRequestSchema.parse({
      projectId: sessionId,
      sourcePath: '/imports/session.jsonl',
    }),
  ).toEqual({ projectId: sessionId, sourcePath: '/imports/session.jsonl' })
  expect(
    exportSessionRequestSchema.parse({
      sessionId,
      format: 'html',
      destinationPath: '/exports/session.html',
    }),
  ).toEqual({ sessionId, format: 'html', destinationPath: '/exports/session.html' })
  expect(defaultSessionExportFileName('invalid:/title  ', 'jsonl')).toBe('invalid__title.jsonl')
})
