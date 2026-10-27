import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { developmentPluginsDirectory } from './plugin-roots.js'
// The guide plugin is plain ESM with node builtins only, so the test can use the very
// function that renders the skill instead of a copy of its logic.
import { skillBody } from '../../../../plugins/pictor-guide/index.js'

/**
 * The guide ships a path the agent will write into; the app discovers a path it computes
 * itself. Two places, one fact — so they are checked against each other here.
 *
 * Without this the failure is silent in the worst way: the skill stays perfectly readable
 * while every plugin an agent writes lands somewhere nothing watches.
 */
const GUIDE = join(import.meta.dirname, '..', '..', '..', '..', 'plugins', 'pictor-guide')

describe('development plugin directory', () => {
  it('is the person’s own directory, not profile data', () => {
    expect(developmentPluginsDirectory({}, '/home/me')).toBe('/home/me/Pictor/plugins')
  })

  it('is the path the shipped guide fills in', () => {
    const rendered = skillBody('/home/me', {})
    const expected = developmentPluginsDirectory({}, '/home/me')

    // Named twice: once as the place, once in the example tree.
    expect(rendered.split(expected).length - 1).toBeGreaterThanOrEqual(2)
    expect(rendered).not.toContain('{{DEVELOPMENT_DIRECTORY}}')
  })

  it('follows an explicit location, in the code and in the guide alike', () => {
    // A manual that names a different folder than the app watches is worse than none, so
    // the override is applied in one place and checked against the other.
    const environment = { PICTOR_DEVELOPMENT_PLUGINS: '/work/our-plugins' }

    expect(developmentPluginsDirectory(environment, '/home/me')).toBe('/work/our-plugins')
    expect(skillBody('/home/me', environment)).toContain('/work/our-plugins')
  })

  it('ships as a template with the placeholder, so the real home is decided at mount', () => {
    const skill = readFileSync(join(GUIDE, 'SKILL.md'), 'utf8')

    expect(skill).toContain('{{DEVELOPMENT_DIRECTORY}}')
  })
})
