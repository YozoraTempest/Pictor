import { describe, expect, it } from 'vitest'

import { isToolPattern, matchesTool, toolPatternSpecificity } from './tool-pattern.js'

/**
 * One matcher, three contribution points.
 *
 * The rule has to be boring: a name that a person writes in a manifest must mean exactly
 * what a guard, a hook and a view each think it means. These cases are the whole language.
 */

describe('isToolPattern', () => {
  it('accepts an ordinary tool name', () => {
    expect(isToolPattern('read')).toBe(true)
    expect(isToolPattern('str_replace_editor')).toBe(true)
    expect(isToolPattern('web.fetch')).toBe(true)
  })

  it('accepts an MCP tool, exactly and as a namespace', () => {
    // How an MCP tool is really named: doubled separators an ordinary name never has,
    // which is why one rule has to cover both the exact name and the prefix.
    expect(isToolPattern('mcp__github__create_issue')).toBe(true)
    expect(isToolPattern('mcp__github__*')).toBe(true)
    expect(isToolPattern('mcp__github__')).toBe(true)
  })

  it('refuses anything that is not a name or a trailing prefix', () => {
    expect(isToolPattern('')).toBe(false)
    expect(isToolPattern('*')).toBe(false)
    expect(isToolPattern('mcp__*__write')).toBe(false)
    expect(isToolPattern('Read')).toBe(false)
    expect(isToolPattern(' read')).toBe(false)
    expect(isToolPattern('mcp__github__*x')).toBe(false)
  })
})

describe('matchesTool', () => {
  it('matches an exact name exactly', () => {
    expect(matchesTool('bash', 'bash')).toBe(true)
    expect(matchesTool('bash', 'bashful')).toBe(false)
  })

  it('matches everything under a prefix', () => {
    expect(matchesTool('mcp__github__*', 'mcp__github__create_issue')).toBe(true)
    expect(matchesTool('mcp__github__*', 'mcp__github__')).toBe(true)
    expect(matchesTool('mcp__github__*', 'mcp__gitlab__create_issue')).toBe(false)
    expect(matchesTool('mcp__git*', 'mcp__gitlab__x')).toBe(true)
  })
})

describe('toolPatternSpecificity', () => {
  it('puts an exact name above every prefix', () => {
    expect(toolPatternSpecificity('read')).toBeGreaterThan(toolPatternSpecificity('r*'))
  })

  it('prefers the narrower prefix', () => {
    expect(toolPatternSpecificity('mcp__github__*')).toBeGreaterThan(
      toolPatternSpecificity('mcp__*'),
    )
  })
})
