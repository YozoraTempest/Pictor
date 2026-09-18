// @vitest-environment jsdom

import { expect, it } from 'vitest'

import { WebConnectionStatusView } from './connection-status.js'

it('shows recovery state without occupying the ready interface', () => {
  const view = new WebConnectionStatusView()
  const status = document.querySelector<HTMLElement>('.web-connection-status')!

  view.update('reconnecting')
  expect(status.hidden).toBe(false)
  expect(status).toHaveTextContent('重新启动')

  view.update('ready')
  expect(status.hidden).toBe(true)

  view.showReload()
  expect(status).toHaveTextContent('重新装配')
  view.stop()
  expect(document.querySelector('.web-connection-status')).toBeNull()
})
