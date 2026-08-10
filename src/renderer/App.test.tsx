import { render, screen } from '@testing-library/react'

import type { PictorBridge } from '../shared/contracts'
import { App } from './App'

beforeEach(() => {
  const bridge: PictorBridge = {
    getAppInfo: async () => ({ name: 'Pictor', version: '0.1.0', platform: 'win32' }),
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
