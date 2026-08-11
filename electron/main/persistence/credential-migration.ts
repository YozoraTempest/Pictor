import type { Dirent } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { sessionRecordSchema } from '../../../src/shared/contracts.js'
import { createSecretRedactor, type SecretRedactor } from '../../../src/shared/secret-redaction.js'
import { writeTextFile } from './atomic-json.js'

export type CredentialMigrationScope = 'session' | 'pi'
export type CredentialMigrationOperation = 'list' | 'read' | 'parse' | 'write'

export interface CredentialMigrationFailure {
  scope: CredentialMigrationScope
  path: string
  operation: CredentialMigrationOperation
}

export interface CredentialMigrationResult {
  attempted: boolean
  failures: CredentialMigrationFailure[]
}

export interface MigrationIo {
  listDirectory: (path: string) => Promise<Pick<Dirent, 'name' | 'isDirectory' | 'isFile'>[]>
  readText: (path: string) => Promise<string>
  writeText: (path: string, content: string) => Promise<void>
}

const defaultIo: MigrationIo = {
  listDirectory: (path) => readdir(path, { withFileTypes: true }),
  readText: (path) => readFile(path, 'utf8'),
  writeText: writeTextFile,
}

function redactSessionFile(content: string, redactor: SecretRedactor): string {
  const session = sessionRecordSchema.parse(JSON.parse(content))
  const redacted = redactor.redactSession(session)
  return JSON.stringify(redacted) === JSON.stringify(session)
    ? content
    : `${JSON.stringify(redacted, null, 2)}\n`
}

function redactPiTranscript(content: string, redactor: SecretRedactor): string {
  const hasTrailingNewline = /\r?\n$/.test(content)
  const lines = content.split(/\r?\n/)
  if (hasTrailingNewline) lines.pop()
  let changed = false
  const redactedLines = lines.map((line) => {
    if (!line.trim()) return line
    const entry: unknown = JSON.parse(line)
    const redacted = redactor.redactPiEntry(entry)
    if (JSON.stringify(redacted) === JSON.stringify(entry)) return line
    changed = true
    return JSON.stringify(redacted)
  })
  if (!changed) return content
  return `${redactedLines.join('\n')}${hasTrailingNewline ? '\n' : ''}`
}

async function migrateFile(
  path: string,
  scope: CredentialMigrationScope,
  transform: (content: string) => string,
  io: MigrationIo,
  failures: CredentialMigrationFailure[],
): Promise<void> {
  let content: string
  try {
    content = await io.readText(path)
  } catch {
    failures.push({ scope, path, operation: 'read' })
    return
  }

  let redacted: string
  try {
    redacted = transform(content)
  } catch {
    failures.push({ scope, path, operation: 'parse' })
    return
  }

  if (redacted === content) return
  try {
    await io.writeText(path, redacted)
  } catch {
    failures.push({ scope, path, operation: 'write' })
  }
}

async function migrateDirectory(
  directory: string,
  extension: string,
  scope: CredentialMigrationScope,
  transform: (content: string) => string,
  io: MigrationIo,
  failures: CredentialMigrationFailure[],
): Promise<void> {
  let entries
  try {
    entries = await io.listDirectory(directory)
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return
    }
    failures.push({ scope, path: directory, operation: 'list' })
    return
  }

  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      await migrateDirectory(path, extension, scope, transform, io, failures)
    } else if (entry.isFile() && entry.name.endsWith(extension)) {
      await migrateFile(path, scope, transform, io, failures)
    }
  }
}

export async function migrateCredentialPersistence(
  dataDirectory: string,
  secretValues: readonly string[],
  io: MigrationIo = defaultIo,
): Promise<CredentialMigrationResult> {
  if (secretValues.length === 0) return { attempted: false, failures: [] }
  const redactor = createSecretRedactor(secretValues)
  const failures: CredentialMigrationFailure[] = []
  await migrateDirectory(
    join(dataDirectory, 'sessions'),
    '.json',
    'session',
    (content) => redactSessionFile(content, redactor),
    io,
    failures,
  )
  await migrateDirectory(
    join(dataDirectory, 'pi'),
    '.jsonl',
    'pi',
    (content) => redactPiTranscript(content, redactor),
    io,
    failures,
  )
  return { attempted: true, failures }
}
