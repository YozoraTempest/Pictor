import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { PluginRuntime } from './plugin-runtime.js'
import { SkillLibrary } from './skill-library.js'

/**
 * Reconciling is what makes "write a folder and it runs" true.
 *
 * The cases are the three answers it has to give: something new gets mounted, something
 * gone gets unmounted, and something the person switched off stays off even though its
 * files are right there. The third one is the reason this is not just "mount everything
 * discovered" — a switch is a decision, and a reconciler that forgets it would turn a plugin
 * back on behind the person's back.
 */
const made: string[] = []

function workspace(): { root: string; runtime: PluginRuntime; changes: () => number } {
  const root = mkdtempSync(join(tmpdir(), 'pictor-reconcile-'))
  made.push(root)
  let changes = 0
  const runtime = new PluginRuntime({
    userData: join(root, 'profile'),
    // A parent directory, the way `~/Pictor/plugins` is: one level up from any plugin.
    pluginParents: () => [root],
    onPluginsChanged: () => {
      changes += 1
    },
    // A watcher would add a second, timing-dependent path into the same assertion; the
    // reconcile itself is what these tests are about.
    hotReload: false,
  })
  return { root, runtime, changes: () => changes }
}

/** One plugin directory, written the way a person or an agent would. */
function skillsIn(root: string): SkillLibrary {
  return new SkillLibrary({
    root: join(root, 'skills'),
    stash: join(root, 'skills-off'),
    stateFile: join(root, 'skills.json'),
  })
}

function writePlugin(root: string, directory: string, id: string, title: string): void {
  const folder = join(root, directory)
  mkdirSync(folder, { recursive: true })
  writeFileSync(
    join(folder, 'package.json'),
    JSON.stringify({ name: directory, version: '1.0.0', type: 'module', main: 'index.js' }),
  )
  writeFileSync(
    join(folder, 'index.js'),
    `export const inject = ['pictor']
export function apply(ctx) {
  ctx.effect(() => ctx.pictor.views({ id: '${id}.view', title: '${title}', data: () => ({ blocks: [] }) }))
  ctx.effect(() => ctx.pictor.panels({ id: '${id}.panel', title: '${title}', view: '${id}.view' }))
}
`,
  )
}

afterEach(() => {
  for (const root of made.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('PluginRuntime.reconcile', () => {
  it('mounts a plugin that appeared and unmounts one that went away', async () => {
    const { root, runtime, changes } = workspace()
    try {
      await runtime.reconcile()
      expect(runtime.mounted()).toHaveLength(0)

      writePlugin(root, 'first', 'acme.first', '第一个')
      await runtime.reconcile()

      expect(runtime.mounted().map((plugin) => plugin.id)).toEqual(['first'])
      expect(runtime.panels().map((panel) => panel.title)).toEqual(['第一个'])
      expect(changes()).toBe(1)

      // Deleting the folder is the other half of the same promise.
      rmSync(join(root, 'first'), { recursive: true })
      await runtime.reconcile()

      expect(runtime.mounted()).toHaveLength(0)
      expect(runtime.panels()).toHaveLength(0)
      expect(changes()).toBe(2)
    } finally {
      runtime.dispose()
    }
  })

  it('brings a plugin back when its folder returns', async () => {
    // A vanished directory is not a decision to switch the plugin off, so putting it back
    // has to bring it back — otherwise deleting a folder would be a one-way door.
    const { root, runtime } = workspace()
    try {
      writePlugin(root, 'again', 'acme.again', '再来')
      await runtime.reconcile()
      expect(runtime.mounted()).toHaveLength(1)

      rmSync(join(root, 'again'), { recursive: true })
      await runtime.reconcile()
      expect(runtime.mounted()).toHaveLength(0)

      writePlugin(root, 'again', 'acme.again', '再来')
      await runtime.reconcile()
      expect(runtime.mounted().map((plugin) => plugin.id)).toEqual(['again'])
    } finally {
      runtime.dispose()
    }
  })

  it('leaves a switched-off plugin off', async () => {
    const { root, runtime } = workspace()
    try {
      writePlugin(root, 'quiet', 'acme.quiet', '安静的')
      await runtime.reconcile()
      await runtime.remove('quiet')

      await runtime.reconcile()
      expect(runtime.mounted()).toHaveLength(0)
      expect(runtime.isEnabled('quiet')).toBe(false)
    } finally {
      runtime.dispose()
    }
  })

  it('queues overlapping reconciles instead of mounting twice', async () => {
    const { root, runtime } = workspace()
    try {
      writePlugin(root, 'once', 'acme.once', '一次')
      await Promise.all([runtime.reconcile(), runtime.reconcile(), runtime.reconcile()])

      expect(runtime.mounted().map((plugin) => plugin.id)).toEqual(['once'])
      expect(runtime.failures()).toEqual([])
    } finally {
      runtime.dispose()
    }
  })

  it('writes a contributed skill to disk, where the runtime scans for it', async () => {
    // The gap this covers is a wiring one, and it was real: the runtime had an optional
    // skill library that nothing passed, so a plugin's skill existed only in memory and
    // the runtime never saw the file.
    const root = mkdtempSync(join(tmpdir(), 'pictor-reconcile-'))
    made.push(root)
    const library = skillsIn(root)
    const runtime = new PluginRuntime({
      userData: join(root, 'profile'),
      pluginParents: () => [root],
      hotReload: false,
      skills: library,
    })

    try {
      const folder = join(root, 'with-skill')
      mkdirSync(folder, { recursive: true })
      writeFileSync(
        join(folder, 'package.json'),
        JSON.stringify({ name: 'with-skill', version: '1.0.0', type: 'module', main: 'index.js' }),
      )
      writeFileSync(
        join(folder, 'index.js'),
        `export const inject = ['pictor']
export function apply(ctx) {
  ctx.effect(() => ctx.pictor.skills({ name: 'how-to', description: '怎么用', body: '# 正文' }))
}
`,
      )

      await runtime.reconcile()

      const written = library.entries().find((entry) => entry.name === 'how-to')
      expect(written?.source).toBe('with-skill')
      expect(readFileSync(written?.path ?? '', 'utf8')).toContain('# 正文')
    } finally {
      runtime.dispose()
    }
  })

  it('reports a folder that is not a plugin instead of mounting it', async () => {
    const { root, runtime } = workspace()
    try {
      mkdirSync(join(root, 'not-a-plugin'))
      writeFileSync(join(root, 'not-a-plugin', 'README.md'), '# 只是笔记\n')

      await runtime.reconcile()

      expect(runtime.mounted()).toHaveLength(0)
      // A directory with no manifest is skipped silently by discovery: it is not a refused
      // plugin, it is not a plugin.
      expect(runtime.failures()).toEqual([])
    } finally {
      runtime.dispose()
    }
  })
})
