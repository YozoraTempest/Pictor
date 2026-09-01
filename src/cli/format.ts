import type { AppDoctorResult } from '../commands/core.js'
import type { PluginManagerSnapshot } from '../shared/plugins.js'
import type { CliError, CliIo, CliOutputFormat } from './contract.js'

export interface CliSuccessDocument {
  readonly ok: true
  readonly command: string
  readonly value: unknown
}

export interface CliFailureDocument {
  readonly ok: false
  readonly error: CliError
}

export function writeSuccess(
  io: CliIo,
  output: CliOutputFormat,
  command: string,
  value: unknown,
): void {
  if (output === 'json') {
    write(io.stdout, `${JSON.stringify({ ok: true, command, value })}\n`)
    return
  }
  write(io.stdout, formatTextSuccess(command, value))
}

export function writeFailure(io: CliIo, output: CliOutputFormat, error: CliError): void {
  if (output === 'json') {
    const document: CliFailureDocument = { ok: false, error }
    write(io.stdout, `${JSON.stringify(document)}\n`)
    return
  }
  const command = error.commandId ? ` [${error.commandId}]` : ''
  write(io.stderr, `Error${command} (${error.code}): ${error.message}\n`)
}

export function formatTextSuccess(command: string, value: unknown): string {
  if (command === 'version') {
    return `${String((value as { version?: unknown }).version ?? value)}\n`
  }
  if (command === 'help') {
    return `${String((value as { text?: unknown }).text ?? value)}`
  }
  if (command === 'app.doctor') return formatDoctor(value as AppDoctorResult)
  if (command.startsWith('plugin.') || command.startsWith('ui.')) {
    return formatPluginSnapshot(value as PluginManagerSnapshot)
  }
  return `${JSON.stringify(value, null, 2)}\n`
}

function formatDoctor(result: AppDoctorResult): string {
  const lines = [`Doctor: ${result.status}`]
  for (const check of result.checks) {
    lines.push(`[${check.status}] ${check.id}: ${check.message}`)
  }
  return `${lines.join('\n')}\n`
}

function formatPluginSnapshot(snapshot: PluginManagerSnapshot): string {
  const lines = [
    `Plugins: ${snapshot.items.length}`,
    `Safe mode: ${snapshot.safeMode ? 'yes' : 'no'}`,
    `Restart required: ${snapshot.restartRequired ? 'yes' : 'no'}`,
  ]
  if (snapshot.items.length === 0) lines.push('No Plugins installed.')
  for (const item of snapshot.items) {
    const version = item.version ? `@${item.version}` : ''
    const reason = item.reason ? ` — ${item.reason}` : ''
    lines.push(
      `- ${item.kind}:${item.id}${version} | ${item.name} | desired=${item.desiredState} | effective=${item.effectiveState}${reason}`,
    )
  }
  if (snapshot.issues.length > 0) {
    lines.push('Issues:')
    for (const issue of snapshot.issues) lines.push(`- ${issue}`)
  }
  return `${lines.join('\n')}\n`
}

function write(writer: CliIo['stdout'], content: string): void {
  writer.write(content)
}
