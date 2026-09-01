import { describe, expect, it } from 'vitest'

import { safePluginSource, sanitizeGuiDiagnostic } from './diagnostics.js'

describe('GUI diagnostics', () => {
  it.each([
    [String.raw`读取失败: C:\Users\asterism\plugin\index.js`, '读取失败: <local path>'],
    ['读取失败: /home/asterism/plugin/index.js', '读取失败: <local path>'],
    ['读取失败: /root/.config/pictor/registry.json', '读取失败: <local path>'],
    ['读取失败: /mnt/build/pictor/plugin.js', '读取失败: <local path>'],
    ['读取失败: file:///data/pictor/plugin.js', '读取失败: <local path>'],
  ])('redacts local path %s', (message, expected) => {
    expect(sanitizeGuiDiagnostic(message)).toBe(expected)
  })

  it('keeps ordinary diagnostics and HTTP URL semantics intact', () => {
    expect(sanitizeGuiDiagnostic('请求 https://example.com/api/v1 失败')).toBe(
      '请求 https://example.com/api/v1 失败',
    )
    expect(sanitizeGuiDiagnostic('请求 http://localhost:3000/health 失败')).toBe(
      '请求 http://localhost:3000/health 失败',
    )
    expect(sanitizeGuiDiagnostic('Plugin activate failed')).toBe('Plugin activate failed')
  })

  it.each([
    ['bundled:pictor.agent-workspace', 'Bundled'],
    ['development:/workspace/pictor-plugin', 'Development'],
    ['local:/home/asterism/pictor-plugin', 'Local'],
    ['npm:@pictor/example', 'External'],
    ['git+https://github.com/example/pictor-plugin.git', 'External'],
    ['/tmp/pi-ext.ts', 'External'],
    ['/root/pi-package', 'External'],
    ['file:///data/pi-package', 'External'],
    ['unrecognized plugin source', 'External'],
  ])('returns an opaque category for source %s', (source, expected) => {
    expect(safePluginSource(source)).toBe(expected)
    expect(safePluginSource(source)).not.toContain(source)
  })
})
