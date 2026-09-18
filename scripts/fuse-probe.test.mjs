// @vitest-environment node

import process from 'node:process'

import { describe, expect, it } from 'vitest'

import { runProbe } from './fuse-probe.mjs'

describe('fuse probe process', () => {
  it('waits for inherited stdio to close after the parent process exits', async () => {
    const marker = 'grandchild-output-after-parent-exit'
    const grandchildScript = `setTimeout(() => process.stdout.write(${JSON.stringify(marker)}), 100)`
    const parentScript = `
      const { spawn } = require('node:child_process')
      const child = spawn(process.execPath, ['-e', ${JSON.stringify(grandchildScript)}], {
        stdio: ['ignore', 'inherit', 'inherit'],
        windowsHide: true,
      })
      child.unref()
    `

    const result = await runProbe(process.execPath, ['-e', parentScript], process.env, {
      timeoutMs: 2_000,
    })

    expect(result).toMatchObject({ exitCode: 0, timedOut: false })
    expect(result.stdout).toContain(marker)
  })
})
