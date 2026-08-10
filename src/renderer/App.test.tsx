import { render, screen } from '@testing-library/react'

import type { IpcResult, PictorBridge } from '../shared/contracts'
import { App } from './App'

async function unsupported<T>(): Promise<IpcResult<T>> {
  return { ok: false, error: { code: 'internal', message: 'Not implemented in this test' } }
}

beforeEach(() => {
  const bridge: PictorBridge = {
    getAppInfo: async () => ({ name: 'Pictor', version: '0.1.0', platform: 'win32' }),
    getSnapshot: unsupported,
    pickProjectDirectory: unsupported,
    registerProject: unsupported,
    removeProject: unsupported,
    createSession: unsupported,
    renameSession: unsupported,
    deleteSession: unsupported,
    getSession: unsupported,
    getSettings: unsupported,
    saveSettings: unsupported,
    testSettings: unsupported,
  }

  Object.defineProperty(window, 'pictor', {
    configurable: true,
    value: bridge,
  })
})

it('renders the delegate workspace shell', async () => {
  render(<App />)

  expect(screen.getByRole('heading', { name: '选择一个项目开始' })).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: '新建项目' })).toHaveLength(2)
  expect(await screen.findByText('v0.1.0')).toBeInTheDocument()
})
