import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { expect, it } from 'vitest'

const roots = {
  manager: "[data-pictor-plugin='pictor.gui.plugin-manager']",
  updater: "[data-pictor-plugin='pictor.updater']",
  gitChanges: "[data-pictor-plugin='pictor.git-changes']",
  delegate: "[data-pictor-plugin='pictor.workbench.delegate']",
}

const styles = Object.fromEntries(
  await Promise.all(
    Object.entries({
      manager: 'plugins/gui-plugin-manager/styles.css',
      updater: 'plugins/updater/styles.css',
      gitChanges: 'plugins/git-changes/styles.css',
      delegate: 'plugins/workbench-delegate/styles.css',
      host: 'src/gui/styles.css',
    }).map(async ([name, file]) => [name, await readFile(resolve(file), 'utf8')]),
  ),
)

function expectScoped(css, scope) {
  expect(css).toContain(scope)
  expect(css).not.toMatch(/(^|\n)\s*(?::root|html|body|#root|\*)\s*(?:,|\{|:)/m)
  expect(css).not.toMatch(/(^|\n)\s*\.(?:primary-button|form-error)\b/m)

  for (const line of css.split('\n')) {
    const selector = line.trim()
    if (!selector || selector.startsWith('@') || selector === 'to {' || selector === '}') continue
    if (!selector.endsWith('{')) continue
    expect(selector).toMatch(new RegExp(`^${escapeRegExp(scope)}`))
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function expectPrefixedKeyframes(css, prefix) {
  const names = [...css.matchAll(/@(?:-webkit-)?keyframes\s+([\w-]+)/g)].map(([, name]) => name)
  expect(names.length).toBeGreaterThan(0)
  for (const name of names) expect(name).toMatch(new RegExp(`^${escapeRegExp(prefix)}`))
}

it('keeps each product stylesheet inside its stable data scope', () => {
  expectScoped(styles.delegate, roots.delegate)
  expectScoped(styles.manager, roots.manager)
  expectScoped(styles.updater, roots.updater)
  expectScoped(styles.gitChanges, roots.gitChanges)
})

it('keeps product keyframe names globally unique to their plugin', () => {
  expectPrefixedKeyframes(styles.delegate, 'pictor-delegate-')
  expectPrefixedKeyframes(styles.manager, 'pictor-plugin-manager-')
  expectPrefixedKeyframes(styles.updater, 'pictor-updater-')
  expectPrefixedKeyframes(styles.gitChanges, 'pictor-git-changes-')
})

it('keeps product selectors out of the Host stylesheet and Delegate stylesheet', () => {
  for (const selector of [
    'plugin-manager',
    'git-changes-settings',
    'about-settings',
    'update-settings',
    'workspace',
    'sidebar',
  ]) {
    expect(styles.host).not.toContain(`.${selector}`)
  }
  expect(styles.delegate).not.toContain('.plugin-manager')
  expect(styles.delegate).not.toContain('.git-changes-settings')
  expect(styles.delegate).not.toContain('.about-settings')
  expect(styles.delegate).not.toContain('.update-settings')
})
