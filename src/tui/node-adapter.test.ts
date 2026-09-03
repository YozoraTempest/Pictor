// @vitest-environment node

import { expect, it } from 'vitest'

import { createTuiUpdaterHostAdapter } from './node-adapter.js'

it('provides a frontend-safe Updater adapter without Electron', async () => {
  const adapter = createTuiUpdaterHostAdapter()

  expect(adapter.fetch).toBe(globalThis.fetch)
  await expect(adapter.openExternal('https://example.test/update')).rejects.toMatchObject({
    code: 'internal',
    message: 'TUI 不支持打开外部更新链接，请在 GUI 中操作',
  })
})
