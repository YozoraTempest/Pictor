import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { ensurePiHome, piHomeDir, prunePiModels, prunePiModelsFile } from './pi-home.js'

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
