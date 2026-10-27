import { describe, expect, it } from 'vitest'

import { describeAsk, describeCall } from './rule-book.js'

describe('describeCall', () => {
  it('leads with the argument that says what a known tool would do', () => {
    // Approving `bash` without seeing the command is approving a name, not an action.
    expect(describeCall('bash', { command: 'rm -rf build', timeout: 30 })).toBe('rm -rf build')
    expect(describeCall('write', { file_path: '/etc/hosts', content: 'x' })).toBe('/etc/hosts')
  })

  it('shows a tool it does not know as it arrived', () => {
    // Guessing which field matters for an unknown tool would hide what it is about to
    // do, which is the one thing the card exists to show.
    expect(describeCall('some_new_tool', { target: 'prod', force: true })).toBe(
      '{"target":"prod","force":true}',
    )
  })

  it('has nothing to add when the call carries no arguments', () => {
    expect(describeCall('bash', {})).toBeNull()
    expect(describeCall('bash', null)).toBeNull()
  })
})

describe('describeAsk', () => {
  it('says why it is asking and then what the call would do', () => {
    const text = describeAsk({ source: 'mode' }, 'bash', { command: 'ls' })

    expect(text).toBe('这个会话设置为「改动型工具先问我」\nls')
  })

  it('names the rule that asked', () => {
    const text = describeAsk(
      { source: 'rule', rule: { id: 'r1', effect: 'ask', tool: 'bash', pattern: 'rm *' } },
      'bash',
      { command: 'rm -rf build' },
    )

    expect(text).toBe('工具规则「bash(rm *)」要求这次调用先问你\nrm -rf build')
  })
})
