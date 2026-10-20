import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { DiscoveredPlugin } from './registry.js'
import { PluginHost } from './host.js'

interface TestLog {
  activated: string[]
  deactivated: string[]
}

function log(): TestLog {
  const shared = globalThis as typeof globalThis & { __pictorPluginLog?: TestLog }
  shared.__pictorPluginLog ??= { activated: [], deactivated: [] }
  return shared.__pictorPluginLog
}

function writePlugin(parent: string, id: string, body: string): DiscoveredPlugin {
  const root = join(parent, id.replace(/[^a-z0-9]/gi, '-'))
  mkdirSync(root, { recursive: true })

  const manifest = {
    id,
    name: id,
    version: '1.0.0',
    main: 'index.mjs',
    engines: { pictor: '^1.0.0' },
  }
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest))
  writeFileSync(join(root, 'index.mjs'), body)

  return { id, root, manifestPath: join(root, 'manifest.json'), manifest }
}

log()

const goodPlugin = (id: string): string => `
globalThis.__pictorPluginLog.activated.push('${id}')
export default {
  activate(context) {
    context.contribute('commands', { id: '${id}.hello' })
  },
  deactivate() {
    globalThis.__pictorPluginLog.deactivated.push('${id}')
  },
}
`

const throwingPlugin = `
export default {
  activate() {
    throw new Error('boom')
  },
}
`

describe('PluginHost', () => {
  it('activates plugins and collects contributions', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'pictor-host-'))
    const host = new PluginHost({
      plugins: [],
      pictorVersion: '1.0.0',
      dataRoot: join(parent, 'data'),
    })

    const report = await host.start([writePlugin(parent, 'a', goodPlugin('a'))])

    expect(report.activated).toEqual(['a'])
    expect(host.contributions('commands')).toEqual([{ id: 'a.hello' }])
  })

  it('isolates a plugin that throws during activation', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'pictor-host-'))
    const host = new PluginHost({
      plugins: [],
      pictorVersion: '1.0.0',
      dataRoot: join(parent, 'data'),
    })

    const report = await host.start([
      writePlugin(parent, 'broken', throwingPlugin),
      writePlugin(parent, 'healthy', goodPlugin('healthy')),
    ])

    expect(report.activated).toEqual(['healthy'])
    expect(report.failures).toHaveLength(1)
    expect(report.failures[0]?.reason).toMatch(/boom/)
  })

  it('skips disabled plugins without reporting failures', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'pictor-host-'))
    const host = new PluginHost({
      plugins: [],
      pictorVersion: '1.0.0',
      dataRoot: join(parent, 'data'),
      isEnabled: (id) => id !== 'disabled',
    })

    const report = await host.start([
      writePlugin(parent, 'disabled', goodPlugin('disabled')),
      writePlugin(parent, 'enabled', goodPlugin('enabled')),
    ])

    expect(report.skipped).toEqual(['disabled'])
    expect(report.failures).toEqual([])
    expect(host.contributions('commands')).toHaveLength(1)
  })

  it('disposes contributions and deactivates in reverse order', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'pictor-host-'))
    const state = log()
    state.activated.length = 0
    state.deactivated.length = 0

    const host = new PluginHost({
      plugins: [],
      pictorVersion: '1.0.0',
      dataRoot: join(parent, 'data'),
    })

    await host.start([
      writePlugin(parent, 'first', goodPlugin('first')),
      writePlugin(parent, 'second', goodPlugin('second')),
    ])

    await host.stop()

    expect(state.activated).toEqual(['first', 'second'])
    expect(state.deactivated).toEqual(['second', 'first'])
    expect(host.contributions('commands')).toEqual([])
  })
})
