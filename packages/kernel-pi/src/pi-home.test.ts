import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { type McpServerSpec } from '@pictor/shared'

import {
  ensurePiHome,
  piHomeDir,
  prunePiModels,
  prunePiModelsFile,
  writePiMcpJson,
} from './pi-home.js'
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function profile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pictor-pi-home-'))
  dirs.push(dir)
  return dir
}

describe('piHomeDir', () => {
  it('lives inside the profile, not in the user’s Pi directory', () => {
    // Inside Pictor, Pi must see Pictor's services and nothing else; giving it its own
    // config directory is what makes that true.
    expect(piHomeDir('/profile')).toBe('/profile/pi-home')
  })

  it('is created when the driver starts', () => {
    const userData = profile()

    expect(ensurePiHome(userData)).toBe(piHomeDir(userData))
    // It has to exist before Pi is spawned, or Pi writes its settings nowhere.
    expect(statSync(piHomeDir(userData)).isDirectory()).toBe(true)
  })
})

describe('prunePiModels', () => {
  it('keeps what Pictor can still offer and drops the rest', () => {
    const { kept, dropped } = prunePiModels({
      a: 'pictor-deepseek/deepseek-flash',
      b: 'deepseek/deepseek-v4-pro',
      c: 'neko/deepseek-v4.1-flash',
      d: 42,
    })

    expect(kept).toEqual({ a: 'pictor-deepseek/deepseek-flash' })
    expect(dropped).toEqual(['b', 'c', 'd'])
  })
})

describe('prunePiModelsFile', () => {
  it('rewrites the file only when something was forgotten', () => {
    const userData = profile()
    const file = join(userData, 'pi-models.json')

    writeFileSync(file, JSON.stringify({ a: 'pictor-deepseek/x' }), 'utf8')
    expect(prunePiModelsFile(userData)).toBe(0)

    writeFileSync(file, JSON.stringify({ a: 'pictor-deepseek/x', b: 'deepseek/y' }), 'utf8')
    expect(prunePiModelsFile(userData)).toBe(1)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ a: 'pictor-deepseek/x' })
  })

  it('says nothing when there is no file to prune', () => {
    expect(prunePiModelsFile(profile())).toBe(0)
  })
})

describe('writePiMcpJson', () => {
  it('renders one list into the shape Pi reads', () => {
    const home = piHomeDir(profile())

    writePiMcpJson(home, [
      { ...spec('files'), args: ['-y', 'server-filesystem'], env: { ROOTS: '/work' } },
      { ...spec('docs'), transport: 'http', url: 'https://example.com/mcp', headers: { A: 'b' } },
      // Switched off on the page: Pi must not start it either.
      { ...spec('off'), enabled: false },
    ])

    expect(JSON.parse(readFileSync(join(home, 'mcp.json'), 'utf8'))).toEqual({
      mcpServers: {
        files: { command: 'node', args: ['-y', 'server-filesystem'], env: { ROOTS: '/work' } },
        docs: { url: 'https://example.com/mcp', headers: { A: 'b' } },
      },
    })
  })

  it('leaves out what Pi would fill in itself', () => {
    const home = piHomeDir(profile())

    writePiMcpJson(home, [spec('bare')])

    expect(JSON.parse(readFileSync(join(home, 'mcp.json'), 'utf8'))).toEqual({
      mcpServers: { bare: { command: 'node' } },
    })
  })

  it('removes a stale file once every server is gone', () => {
    const home = piHomeDir(profile())
    writePiMcpJson(home, [spec('files')])

    // A file left behind would keep a server running that the page no longer lists.
    writePiMcpJson(home, [{ ...spec('files'), enabled: false }])

    expect(() => readFileSync(join(home, 'mcp.json'), 'utf8')).toThrow()
  })
})

/** One stdio server, with only the fields a test cares about. */
function spec(name: string): McpServerSpec {
  return {
    name,
    transport: 'stdio',
    command: 'node',
    args: [],
    env: {},
    url: '',
    headers: {},
    enabled: true,
  }
}
