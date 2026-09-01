// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { CliUsageError, parseCliArgs } from './parser.js'

describe('parseCliArgs', () => {
  it.each([
    ['local', { source: 'local', path: '/tmp/plugin' }],
    ['development', { source: 'development', path: '/tmp/plugin' }],
    ['pi-extension', { source: 'pi-extension', path: '/tmp/extension.ts' }],
    ['pi-package', { source: 'pi-package', path: '/tmp/package' }],
    ['pi-package-spec', { source: 'pi-package-spec', spec: 'example-package' }],
  ])('maps the %s install source to the Command Engine input', (source, expected) => {
    const path =
      source === 'pi-extension'
        ? '/tmp/extension.ts'
        : source === 'pi-package'
          ? '/tmp/package'
          : '/tmp/plugin'
    const args =
      source === 'pi-package-spec'
        ? ['plugin', 'install', '--source', source, '--spec', 'example-package']
        : ['plugin', 'install', '--source', source, '--path', path]
    expect(parseCliArgs(args).request).toMatchObject({
      kind: 'command',
      command: { commandId: 'plugin.install', input: expected },
    })
  })

  it('requires explicit kind and id for Plugin identity operations', () => {
    expect(() => parseCliArgs(['plugin', 'enable', '--id', 'pictor.example'])).toThrow(
      'Plugin 身份参数无效',
    )
    expect(() =>
      parseCliArgs(['plugin', 'enable', '--kind', 'invalid', '--id', 'pictor.example']),
    ).toThrow('Plugin 身份参数无效')
    expect(
      parseCliArgs(['plugin', 'enable', '--kind', 'pictor-plugin', '--id', 'pictor.example']),
    ).toMatchObject({ request: { command: { commandId: 'plugin.enable' } } })
  })

  it('rejects source-specific arguments that the Core schema does not accept', () => {
    expect(() =>
      parseCliArgs(['--json', 'plugin', 'install', '--source', 'local', '--spec', 'wrong']),
    ).toThrow(CliUsageError)
    expect(() =>
      parseCliArgs(['plugin', 'install', '--source', 'pi-package-spec', '--path', '/tmp/wrong']),
    ).toThrow(CliUsageError)
  })
})
