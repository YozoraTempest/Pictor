// @vitest-environment node

import { describe, expect, it } from 'vitest'

import {
  runtimeCommandSchema,
  runtimeCompactResultSchema,
  runtimeExportResultSchema,
  runtimeForkResultSchema,
  runtimeHostMessageSchema,
  runtimeImportResultSchema,
  runtimeNavigateResultSchema,
} from './runtime-protocol.js'

const operationId = '01234567-89ab-4def-8123-456789abcdef'
const sourceSessionId = '11234567-89ab-4def-8123-456789abcdef'
const targetSessionId = '21234567-89ab-4def-8123-456789abcdef'

describe('Runtime Session operation protocol', () => {
  it('accepts the complete source and target Session configuration', () => {
    expect(
      runtimeCommandSchema.parse({
        type: 'fork',
        operationId,
        sourceSessionId,
        targetSessionId,
        entryId: 'pi-entry-id',
        projectRoot: '/project',
        agentDirectory: '/agent',
        sourceSessionDirectory: '/sessions/source',
        sourcePiSessionFile: 'source.jsonl',
        targetSessionDirectory: '/sessions/target',
        settings: {
          apiProtocol: 'responses',
          baseUrl: 'https://example.test/v1',
          modelId: 'test-model',
          reasoningEffort: 'high',
          temperature: null,
          maxOutputTokens: 1024,
        },
        apiKey: 'test-key',
      }),
    ).toMatchObject({ type: 'fork', operationId, sourceSessionId, targetSessionId })
  })

  it.each([
    {
      type: 'host.forkResult',
      operationId,
      targetSessionId,
      outcome: 'completed',
      piSessionId: 'forked-pi-session',
      piSessionFile: 'forked.jsonl',
    },
    { type: 'host.forkResult', operationId, targetSessionId, outcome: 'cancelled' },
    {
      type: 'host.forkResult',
      operationId,
      targetSessionId,
      outcome: 'failed',
      message: 'Fork failed',
    },
  ])('accepts host result $outcome', (result) => {
    expect(runtimeForkResultSchema.parse(result)).toEqual(result)
    expect(runtimeHostMessageSchema.parse(result)).toEqual(result)
  })

  it('accepts Import commands and host results', () => {
    expect(
      runtimeCommandSchema.parse({
        type: 'import',
        operationId,
        targetSessionId,
        projectRoot: '/project',
        agentDirectory: '/agent',
        sourceJsonlPath: '/imports/source.jsonl',
        targetSessionDirectory: '/sessions/imported',
        settings: {
          apiProtocol: 'responses',
          baseUrl: 'https://example.test/v1',
          modelId: 'test-model',
          reasoningEffort: null,
          temperature: null,
          maxOutputTokens: 1024,
        },
        apiKey: 'test-key',
      }),
    ).toMatchObject({ type: 'import', operationId, targetSessionId })

    const results = [
      {
        type: 'host.importResult',
        operationId,
        targetSessionId,
        outcome: 'completed',
        piSessionId: 'imported-pi-session',
        piSessionFile: 'source.jsonl',
      },
      { type: 'host.importResult', operationId, targetSessionId, outcome: 'cancelled' },
      {
        type: 'host.importResult',
        operationId,
        targetSessionId,
        outcome: 'failed',
        message: 'Import failed',
      },
    ] as const
    for (const result of results) {
      expect(runtimeImportResultSchema.parse(result)).toEqual(result)
      expect(runtimeHostMessageSchema.parse(result)).toEqual(result)
    }
  })

  it('accepts native Pi Session Export commands and host results', () => {
    expect(
      runtimeCommandSchema.parse({
        type: 'export',
        operationId,
        sourceSessionId,
        format: 'html',
        projectRoot: '/project',
        agentDirectory: '/agent',
        sourceSessionDirectory: '/sessions/source',
        sourcePiSessionFile: 'source.jsonl',
        destinationPath: '/exports/source.html',
        settings: {
          apiProtocol: 'responses',
          baseUrl: 'https://example.test/v1',
          modelId: 'test-model',
          reasoningEffort: null,
          temperature: null,
          maxOutputTokens: 1024,
        },
        apiKey: 'test-key',
      }),
    ).toMatchObject({ type: 'export', operationId, sourceSessionId, format: 'html' })

    const results = [
      { type: 'host.exportResult', operationId, sourceSessionId, outcome: 'completed' },
      {
        type: 'host.exportResult',
        operationId,
        sourceSessionId,
        outcome: 'failed',
        message: 'Export failed',
      },
    ] as const
    for (const result of results) {
      expect(runtimeExportResultSchema.parse(result)).toEqual(result)
      expect(runtimeHostMessageSchema.parse(result)).toEqual(result)
    }
  })

  it('accepts same-file Pi Session Tree Navigation commands and host results', () => {
    expect(
      runtimeCommandSchema.parse({
        type: 'navigate',
        operationId,
        sourceSessionId,
        entryId: 'historical-answer',
        summarize: false,
        customInstructions: null,
        activeLeafId: 'active-answer',
        projectRoot: '/project',
        agentDirectory: '/agent',
        sourceSessionDirectory: '/sessions/source',
        sourcePiSessionFile: 'source.jsonl',
        settings: {
          apiProtocol: 'responses',
          baseUrl: 'https://example.test/v1',
          modelId: 'test-model',
          reasoningEffort: null,
          temperature: null,
          maxOutputTokens: 1024,
        },
        apiKey: 'test-key',
      }),
    ).toMatchObject({ type: 'navigate', operationId, sourceSessionId })

    const results = [
      {
        type: 'host.navigateResult',
        operationId,
        sourceSessionId,
        outcome: 'completed',
        activeLeafId: 'historical-answer',
        editorText: null,
        summaryCreated: false,
      },
      { type: 'host.navigateResult', operationId, sourceSessionId, outcome: 'cancelled' },
      {
        type: 'host.navigateResult',
        operationId,
        sourceSessionId,
        outcome: 'failed',
        message: 'Navigation failed',
      },
    ] as const
    for (const result of results) {
      expect(runtimeNavigateResultSchema.parse(result)).toEqual(result)
      expect(runtimeHostMessageSchema.parse(result)).toEqual(result)
    }
  })

  it('accepts cancellable Pi Session Compaction commands and host results', () => {
    expect(
      runtimeCommandSchema.parse({
        type: 'compact',
        operationId,
        sourceSessionId,
        customInstructions: 'Keep decisions and unresolved work.',
        activeLeafId: 'active-answer',
        projectRoot: '/project',
        agentDirectory: '/agent',
        sourceSessionDirectory: '/sessions/source',
        sourcePiSessionFile: 'source.jsonl',
        settings: {
          apiProtocol: 'responses',
          baseUrl: 'https://example.test/v1',
          modelId: 'test-model',
          reasoningEffort: null,
          temperature: null,
          maxOutputTokens: 1024,
        },
        apiKey: 'test-key',
      }),
    ).toMatchObject({ type: 'compact', operationId, sourceSessionId })
    expect(runtimeCommandSchema.parse({ type: 'abort-session-operation', operationId })).toEqual({
      type: 'abort-session-operation',
      operationId,
    })

    const results = [
      {
        type: 'host.compactResult',
        operationId,
        sourceSessionId,
        outcome: 'completed',
        activeLeafId: 'compaction-entry',
        tokensBefore: 100,
        estimatedTokensAfter: 25,
      },
      { type: 'host.compactResult', operationId, sourceSessionId, outcome: 'cancelled' },
      {
        type: 'host.compactResult',
        operationId,
        sourceSessionId,
        outcome: 'failed',
        message: 'Compaction failed',
      },
    ] as const
    for (const result of results) {
      expect(runtimeCompactResultSchema.parse(result)).toEqual(result)
      expect(runtimeHostMessageSchema.parse(result)).toEqual(result)
    }
  })
})
