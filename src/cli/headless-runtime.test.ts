// @vitest-environment node

import { expect, it } from 'vitest'

import { HEADLESS_RUNTIME_UNAVAILABLE_MESSAGE, HeadlessRuntimeHost } from './headless-runtime.js'

it('keeps Runtime operations explicit and unavailable in the CLI adapter', async () => {
  const runtime = new HeadlessRuntimeHost()

  await expect(runtime.start({} as never)).rejects.toThrow(HEADLESS_RUNTIME_UNAVAILABLE_MESSAGE)
  await expect(runtime.reloadResources('session')).rejects.toThrow(
    HEADLESS_RUNTIME_UNAVAILABLE_MESSAGE,
  )
  expect(runtime.isActive()).toBe(false)
  await expect(runtime.dispose()).resolves.toBeUndefined()
})
