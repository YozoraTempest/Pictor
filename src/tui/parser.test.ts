// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { parseTuiArgs, TuiUsageError } from './parser.js'

describe('TUI argument parser', () => {
  it('parses explicit profile, project/session target, safe mode, and smoke mode', () => {
    expect(
      parseTuiArgs([
        '--user-data-dir=/tmp/pictor-tui',
        '--profile',
        'developer',
        '--project',
        '/workspace/project',
        '--session=11111111-1111-4111-8111-111111111111',
        '--safe-mode',
        '--non-interactive',
        '--tui-mode',
        'fullscreen',
      ]),
    ).toEqual({
      userDataDirectory: '/tmp/pictor-tui',
      profile: 'developer',
      safeMode: true,
      projectPath: '/workspace/project',
      sessionId: '11111111-1111-4111-8111-111111111111',
      nonInteractive: true,
      tuiMode: 'fullscreen',
      help: false,
      version: false,
    })
  })

  it('keeps help/version pure and rejects ambiguous or unknown options', () => {
    expect(parseTuiArgs(['--help']).help).toBe(true)
    expect(parseTuiArgs(['--version']).version).toBe(true)
    expect(() => parseTuiArgs(['--help', '--version'])).toThrow(TuiUsageError)
    expect(() => parseTuiArgs(['--tui-mode', 'regular', '--tui-mode', 'fullscreen'])).toThrow(
      '不能重复指定',
    )
    expect(() => parseTuiArgs(['--unknown'])).toThrow('无法识别')
    expect(() => parseTuiArgs(['--project'])).toThrow('缺少参数')
    expect(() => parseTuiArgs(['--user-data-dir='])).toThrow('缺少参数')
  })
})
