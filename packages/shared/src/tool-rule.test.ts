import { describe, expect, it } from 'vitest'

import {
  allowsTool,
  askVerdict,
  matchAskRule,
  matchDenyRule,
  matchesGlob,
  parseToolRules,
  ruleSubjects,
} from './tool-rule.js'
import type { ToolRule } from './tool-rule.js'

function rule(overrides: Partial<ToolRule> & Pick<ToolRule, 'effect' | 'tool'>): ToolRule {
  return { id: overrides.id ?? 'r1', pattern: '', ...overrides }
}

describe('matchesGlob', () => {
  it('treats * as any run of characters', () => {
    expect(matchesGlob('npm publish*', 'npm publish --access public')).toBe(true)
    expect(matchesGlob('npm publish*', 'npm run publish')).toBe(false)
  })

  it('escapes everything a regex would read specially', () => {
    expect(matchesGlob('a.b', 'a.b')).toBe(true)
    expect(matchesGlob('a.b', 'axb')).toBe(false)
    expect(matchesGlob('a+b', 'a+b')).toBe(true)
  })

  it('matches everything when the pattern is empty', () => {
    expect(matchesGlob('', 'anything at all')).toBe(true)
  })
})

describe('ruleSubjects', () => {
  it('reads the argument that matters for a known tool', () => {
    expect(ruleSubjects('bash', { command: 'rm -rf /', description: 'cleanup' })).toEqual([
      'rm -rf /',
    ])
    expect(ruleSubjects('write', { file_path: '/etc/passwd', content: 'x' })).toEqual([
      '/etc/passwd',
    ])
  })

  it('falls back to every string for a tool it does not know', () => {
    expect(ruleSubjects('mystery', { a: 'one', b: ['two'] })).toEqual(['one', 'two'])
  })

  it('ignores non-string arguments', () => {
    expect(ruleSubjects('bash', { command: 7 })).toEqual([])
  })
})

describe('matchDenyRule', () => {
  it('refuses a call whose argument matches', () => {
    const rules = [rule({ effect: 'deny', tool: 'bash', pattern: 'npm publish*' })]

    expect(matchDenyRule(rules, { tool: 'bash', args: { command: 'npm publish' } })?.id).toBe('r1')
    expect(matchDenyRule(rules, { tool: 'bash', args: { command: 'npm test' } })).toBeNull()
  })

  it('refuses any call to a bare tool rule', () => {
    const rules = [rule({ effect: 'deny', tool: 'web_fetch' })]

    expect(
      matchDenyRule(rules, { tool: 'web_fetch', args: { url: 'https://example.com' } }),
    ).not.toBeNull()
    expect(matchDenyRule(rules, { tool: 'read', args: { path: '/a' } })).toBeNull()
  })

  it('honours a wildcard tool', () => {
    const rules = [rule({ effect: 'deny', tool: '*', pattern: '*.pem' })]

    expect(matchDenyRule(rules, { tool: 'read', args: { path: '/keys/a.pem' } })).not.toBeNull()
  })

  it('ignores allow rules, which decide something else', () => {
    const rules = [rule({ effect: 'allow', tool: 'bash' })]

    expect(matchDenyRule(rules, { tool: 'bash', args: { command: 'npm publish' } })).toBeNull()
  })

  it('takes the first match, so the list reads like a policy', () => {
    const rules = [
      rule({ id: 'first', effect: 'deny', tool: 'bash', pattern: 'rm *' }),
      rule({ id: 'second', effect: 'deny', tool: 'bash', pattern: 'rm -rf *' }),
    ]

    expect(matchDenyRule(rules, { tool: 'bash', args: { command: 'rm -rf /' } })?.id).toBe('first')
  })
})

describe('matchAskRule', () => {
  it('holds the calls its glob covers', () => {
    const rules = [rule({ effect: 'ask', tool: 'bash', pattern: 'rm *' })]

    expect(matchAskRule(rules, { tool: 'bash', args: { command: 'rm -rf build' } })?.id).toBe('r1')
    expect(matchAskRule(rules, { tool: 'bash', args: { command: 'ls' } })).toBeNull()
    // A deny is not an ask: the two pause differently, and one must not stand in
    // for the other.
    expect(
      matchAskRule([rule({ effect: 'deny', tool: 'bash' })], { tool: 'bash', args: {} }),
    ).toBeNull()
  })
})

describe('askVerdict', () => {
  const quiet = { mode: 'never' as const, granted: false }

  it('asks when a rule names the call', () => {
    const verdict = askVerdict([rule({ effect: 'ask', tool: 'write' })], {
      tool: 'write',
      args: { file_path: '/tmp/a' },
      mutating: true,
      ...quiet,
    })

    expect(verdict?.source).toBe('rule')
  })

  it('asks for a mutating call while the session says so', () => {
    expect(
      askVerdict([], { tool: 'bash', args: {}, mutating: true, mode: 'mutating', granted: false })
        ?.source,
    ).toBe('mode')
    // A read-only call is not worth a prompt even then: the mode asks about what can
    // change something, not about every call.
    expect(
      askVerdict([], { tool: 'read', args: {}, mutating: false, mode: 'mutating', granted: false }),
    ).toBeNull()
    expect(
      askVerdict([], { tool: 'bash', args: {}, mutating: true, mode: 'never', granted: false }),
    ).toBeNull()
  })

  it('stops asking for a tool this conversation already allowed', () => {
    // The person answered this tool once with "allow it from now on": a session-wide
    // answer, which outranks the session-wide mode.
    expect(
      askVerdict([], { tool: 'bash', args: {}, mutating: true, mode: 'mutating', granted: true }),
    ).toBeNull()
    // A rule about this call still wins: it is narrower than a session that got tired
    // of clicking, and it was written on purpose.
    expect(
      askVerdict([rule({ effect: 'ask', tool: 'bash', pattern: 'rm *' })], {
        tool: 'bash',
        args: { command: 'rm -rf build' },
        mutating: true,
        mode: 'mutating',
        granted: true,
      })?.source,
    ).toBe('rule')
  })

  it('lets an allow rule answer the mode, and never an ask rule', () => {
    const allow = rule({ effect: 'allow', tool: 'bash' })

    // An allow is the person saying "don't ask me about this tool", which is more
    // specific than the mode.
    expect(
      askVerdict([allow], {
        tool: 'bash',
        args: {},
        mutating: true,
        mode: 'mutating',
        granted: false,
      }),
    ).toBeNull()
    // Two rows about the same tool: the stricter one wins.
    expect(
      askVerdict([allow, rule({ id: 'r2', effect: 'ask', tool: 'bash' })], {
        tool: 'bash',
        args: {},
        mutating: true,
        mode: 'mutating',
        granted: false,
      })?.source,
    ).toBe('rule')
  })
})

describe('allowsTool', () => {
  it('answers for the whole tool, because the prompt carries no arguments', () => {
    const rules = [rule({ effect: 'allow', tool: 'bash', pattern: 'npm test' })]

    expect(allowsTool(rules, 'bash')).toBe(true)
    expect(allowsTool(rules, 'write')).toBe(false)
  })
})

describe('parseToolRules', () => {
  it('keeps well-formed rows and drops the rest', () => {
    const rules = parseToolRules([
      { id: 'a', effect: 'deny', tool: 'bash', pattern: 'rm *' },
      { id: 'b', effect: 'maybe', tool: 'bash', pattern: '' },
      { id: 'a', effect: 'allow', tool: 'bash', pattern: '' },
      { id: 'c', effect: 'allow', tool: 'Not A Tool', pattern: '' },
      { id: 'd', effect: 'allow', tool: '*', pattern: '' },
    ])

    expect(rules.map((rule) => rule.id)).toEqual(['a', 'd'])
  })

  it('reads a missing value as no rules', () => {
    expect(parseToolRules(undefined)).toEqual([])
    expect(parseToolRules(null)).toEqual([])
  })

  it('refuses a value that is not a list at all', () => {
    expect(() => parseToolRules({ id: 'a' })).toThrow(/数组/)
  })
})
