// @vitest-environment node

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SessionManager } from '@earendil-works/pi-coding-agent'

import type { SessionRecord } from '../../shared/domain.js'
import { REDACTED_SECRET } from '../../shared/secret-redaction.js'
import { migrateCredentialPersistence } from './credential-migration.js'

const projectId = '01234567-89ab-4def-8123-456789abcdef'
const sessionId = '11234567-89ab-4def-8123-456789abcdef'
const messageId = '21234567-89ab-4def-8123-456789abcdef'
const now = '2026-08-11T00:00:00.000Z'

function legacySession(secret: string): SessionRecord {
  return {
    schemaVersion: 1,
    id: sessionId,
    projectId,
    title: `legacy ${secret}`,
    messages: [
      {
        id: messageId,
        role: 'user',
        content: `keep-before ${secret} keep-after`,
        status: 'completed',
        createdAt: now,
        updatedAt: now,
      },
    ],
    runs: [
      {
        id: projectId,
        status: 'running',
        error: `error ${secret}`,
        toolEvents: [],
        createdAt: now,
        updatedAt: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
  }
}

function legacyTranscript(secret: string): string {
  return [
    JSON.stringify({ type: 'session', version: 3, id: sessionId, timestamp: now, cwd: 'C:\\id' }),
    JSON.stringify({
      type: 'message',
      id: 'entry-id',
      parentId: null,
      timestamp: now,
      message: { role: 'user', content: `transcript ${secret}` },
    }),
    JSON.stringify({
      type: 'message',
      id: 'tool-id',
      parentId: 'entry-id',
      timestamp: now,
      message: {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            id: 'call-id',
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
    }),
    '',
  ].join('\n')
}

describe('credential persistence migration', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pictor-credential-migration-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it.each(['a', 'id', 'running'])(
    'atomically and idempotently redacts text without changing structure for short key %s',
    async (secret) => {
      const sessionDirectory = join(root, 'sessions')
      const transcriptDirectory = join(root, 'pi', projectId, sessionId)
      await mkdir(sessionDirectory, { recursive: true })
      await mkdir(transcriptDirectory, { recursive: true })
      const sessionPath = join(sessionDirectory, `${sessionId}.json`)
      const transcriptPath = join(transcriptDirectory, 'legacy.jsonl')
      const unrelatedPath = join(transcriptDirectory, 'notes.txt')
      await writeFile(sessionPath, `${JSON.stringify(legacySession(secret), null, 2)}\n`)
      await writeFile(transcriptPath, legacyTranscript(secret))
      await writeFile(unrelatedPath, secret)

      const firstResult = await migrateCredentialPersistence(root, [secret])
      const firstPass = await Promise.all([
        readFile(sessionPath, 'utf8'),
        readFile(transcriptPath, 'utf8'),
      ])
      const secondResult = await migrateCredentialPersistence(root, [secret])
      const secondPass = await Promise.all([
        readFile(sessionPath, 'utf8'),
        readFile(transcriptPath, 'utf8'),
      ])

      expect(firstResult).toEqual({ attempted: true, failures: [] })
      expect(secondResult).toEqual({ attempted: true, failures: [] })
      expect(secondPass).toEqual(firstPass)
      const storedSession = JSON.parse(firstPass[0]) as SessionRecord
      expect(storedSession).toMatchObject({
        schemaVersion: 1,
        id: sessionId,
        projectId,
        runs: [{ id: projectId, status: 'running' }],
      })
      expect(storedSession.messages[0]?.content).toContain(REDACTED_SECRET)
      const transcriptLines = firstPass[1]
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>)
      expect(transcriptLines[0]).toMatchObject({ type: 'session', id: sessionId, timestamp: now })
      expect(transcriptLines[1]).toMatchObject({
        type: 'message',
        id: 'entry-id',
        parentId: null,
        message: { role: 'user', content: expect.stringContaining(REDACTED_SECRET) },
      })
      expect(transcriptLines[2]).toMatchObject({
        type: 'message',
        id: 'tool-id',
        parentId: 'entry-id',
        message: {
          role: 'assistant',
          provider: 'provider-id',
          model: 'model-id',
          stopReason: 'toolUse',
          content: [
            {
              type: 'toolCall',
              id: 'call-id',
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
      const resumedTranscript = SessionManager.open(transcriptPath)
      expect(resumedTranscript.getHeader()).toMatchObject({
        type: 'session',
        id: sessionId,
        version: 3,
      })
      expect(resumedTranscript.getEntries()).toHaveLength(2)
      expect(resumedTranscript.getLeafId()).toBe('tool-id')
      expect(() => resumedTranscript.buildSessionContext()).not.toThrow()
      expect(await readFile(unrelatedPath, 'utf8')).toBe(secret)
      expect((await readdir(sessionDirectory)).every((name) => !name.endsWith('.tmp'))).toBe(true)
    },
  )

  it('returns parse failures without exposing or overwriting malformed content', async () => {
    const secret = ['malformed', 'credential'].join('-')
    const sessionDirectory = join(root, 'sessions')
    await mkdir(sessionDirectory, { recursive: true })
    const malformedPath = join(sessionDirectory, 'malformed.json')
    const original = `{malformed:"${secret}",keep:true`
    await writeFile(malformedPath, original)

    const result = await migrateCredentialPersistence(root, [secret])

    expect(result).toEqual({
      attempted: true,
      failures: [{ scope: 'session', path: malformedPath, operation: 'parse' }],
    })
    expect(JSON.stringify(result)).not.toContain(secret)
    expect(await readFile(malformedPath, 'utf8')).toBe(original)
  })

  it('reports read and write failures while continuing safe files', async () => {
    const secret = ['partial', 'credential'].join('-')
    const sessionDirectory = join(root, 'sessions')
    await mkdir(sessionDirectory, { recursive: true })
    const safePath = join(sessionDirectory, 'safe.json')
    const readFailurePath = join(sessionDirectory, 'read-failure.json')
    const writeFailurePath = join(sessionDirectory, 'write-failure.json')
    const original = `${JSON.stringify(legacySession(secret), null, 2)}\n`
    await Promise.all(
      [safePath, readFailurePath, writeFailurePath].map((path) => writeFile(path, original)),
    )

    const result = await migrateCredentialPersistence(root, [secret], {
      listDirectory: (path) => readdir(path, { withFileTypes: true }),
      readText: async (path) => {
        if (path === readFailurePath) throw new Error('fixture read failure')
        return readFile(path, 'utf8')
      },
      writeText: async (path, content) => {
        if (path === writeFailurePath) throw new Error('fixture write failure')
        await writeFile(path, content)
      },
    })

    expect(result.failures).toEqual(
      expect.arrayContaining([
        { scope: 'session', path: readFailurePath, operation: 'read' },
        { scope: 'session', path: writeFailurePath, operation: 'write' },
      ]),
    )
    expect(JSON.stringify(result)).not.toContain(secret)
    expect(await readFile(safePath, 'utf8')).toContain(REDACTED_SECRET)
    expect(await readFile(readFailurePath, 'utf8')).toBe(original)
    expect(await readFile(writeFailurePath, 'utf8')).toBe(original)
  })

  it('does not fail when migration roots are absent', async () => {
    await expect(migrateCredentialPersistence(root, ['a'])).resolves.toEqual({
      attempted: true,
      failures: [],
    })
  })
})
