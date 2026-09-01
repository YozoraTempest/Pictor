import { expect, it } from 'vitest'

import { installGuiPluginStyles } from './plugin-style.js'

it('hides the style element identity and makes disposal idempotent', () => {
  const release = installGuiPluginStyles('pictor.example', '.example { color: red; }')
  const style = document.head.querySelector('style[data-pictor-plugin="pictor.example"]')

  expect(style).not.toBeNull()
  expect(style?.textContent).toContain('.example')

  release()
  release()
  expect(document.head.querySelector('style[data-pictor-plugin="pictor.example"]')).toBeNull()
})
