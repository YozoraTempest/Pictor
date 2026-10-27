import { describe, expect, it, vi } from 'vitest'

import { VIEW_LIMITS, type ViewContribution, type ViewSpec } from '@pictor/plugin-sdk'

import { PluginViews } from './plugin-views.js'

/**
 * The runner is where a plugin's function finally gets called, so the cases that matter
 * are the ones where an answer cannot be drawn: a throw, a shape the window does not know,
 * and a view that never answers at all. Each has to name the plugin, or someone reading the
 * panel goes looking in the wrong place.
 */
function view(
  overrides: Partial<ViewContribution> & Pick<ViewContribution, 'id'>,
): ViewContribution {
  return {
    title: overrides.id,
    data: () => ({ blocks: [{ kind: 'text', text: 'ok' }] }),
    ...overrides,
  }
}

/** A frame host that records what it was asked to serve. */
function frames(): { mount: ReturnType<typeof vi.fn> } {
  return { mount: vi.fn(async () => ({ url: 'http://127.0.0.1:9/f/token/' })) }
}

function framed(
  views: ViewContribution[],
  options: { root?: string | null; frames?: ReturnType<typeof frames> | null } = {},
): PluginViews {
  return new PluginViews(views, {
    dataDirectory: (pluginId) => `/tmp/plugin-data/${pluginId}`,
    pluginRoot: () => (options.root === undefined ? '/plugins/acme.demo' : options.root),
    ...(options.frames === null
      ? {}
      : { frames: (options.frames ?? frames()) as unknown as never }),
  }).withOwners(new Map(views.map((entry) => [entry.id, 'acme.demo'])))
}

function runner(views: ViewContribution[], timeoutMs = 50): PluginViews {
  return new PluginViews(views, {
    dataDirectory: (pluginId) => `/tmp/plugin-data/${pluginId}`,
    timeoutMs,
  }).withOwners(new Map(views.map((entry) => [entry.id, 'acme.demo'])))
}

describe('PluginViews.render', () => {
  it('runs the view with the context it is allowed to have', async () => {
    const data = vi.fn(async (): Promise<ViewSpec> => ({
      blocks: [{ kind: 'heading', text: '题目' }],
      note: '读于此刻',
    }))
    const views = runner([view({ id: 'acme.status', data })])

    const render = await views.render('acme.status', { sessionId: 's1' })
    if (render.kind !== 'blocks') throw new Error('描述型视图应当返回块')
    const spec = render.spec as { blocks: unknown[]; note: string }

    expect(spec.note).toBe('读于此刻')
    expect(spec.blocks).toHaveLength(1)
    // The directory is the contributing plugin's own, not one the caller named.
    expect(data).toHaveBeenCalledWith({
      sessionId: 's1',
      dataDirectory: '/tmp/plugin-data/acme.demo',
      pluginId: 'acme.demo',
    })
  })

  it('reports a plugin that throws as that plugin failing', async () => {
    const views = runner([
      view({
        id: 'acme.status',
        title: '状态',
        data: () => {
          throw new Error('git 不在 PATH 里')
        },
      }),
    ])

    await expect(views.render('acme.status', { sessionId: null })).rejects.toThrow(
      /视图「状态」没有产出内容：git 不在 PATH 里/,
    )
  })

  it('reports a malformed answer instead of drawing half of it', async () => {
    const views = runner([
      view({
        id: 'acme.status',
        title: '状态',
        data: () => ({ blocks: [{ kind: 'chart' }] }) as unknown as ViewSpec,
      }),
    ])

    await expect(views.render('acme.status', { sessionId: null })).rejects.toThrow(
      /不符合契约：view\.blocks\[0\]\.kind is not one this window draws: chart/,
    )
  })

  it('gives up on a view that never answers', async () => {
    const views = runner([
      view({ id: 'acme.slow', title: '慢', data: () => new Promise(() => {}) }),
    ])

    await expect(views.render('acme.slow', { sessionId: null })).rejects.toThrow(
      /视图「慢」没有产出内容：.*没有回答/,
    )
  })

  it('refuses a view nobody contributed', async () => {
    await expect(runner([]).render('acme.nope', { sessionId: null })).rejects.toThrow(
      /没有这个视图：acme.nope/,
    )
  })
})

/**
 * A press is answered from here, next to the plugin, and only a description travels back.
 * The cases that matter are the three ways an answer arrives: a new description, nothing
 * at all, and something the window cannot draw.
 */
describe('PluginViews.act', () => {
  it('hands the press to the view that owns the button', async () => {
    const onAction = vi.fn(() => ({ blocks: [{ kind: 'text' as const, text: '按过了' }] }))
    const views = runner([view({ id: 'acme.actions', data: () => ({ blocks: [] }), onAction })])

    const next = (await views.act('acme.actions', {
      action: 'recheck',
      value: 'main',
      sessionId: 's1',
    })) as { blocks: unknown[] }

    expect(next.blocks).toHaveLength(1)
    // Same context as `data`, plus the action: the plugin learns nothing new about the
    // caller from a press that it did not already know from reading.
    expect(onAction).toHaveBeenCalledWith({
      sessionId: 's1',
      dataDirectory: '/tmp/plugin-data/acme.demo',
      pluginId: 'acme.demo',
      action: 'recheck',
      value: 'main',
    })
  })

  it('leaves the panel alone when the press changed nothing visible', async () => {
    // `undefined` is an answer: the click landed, the content stands. Returning null is how
    // that reaches the window without it mistaking an empty answer for a doomed read.
    const views = runner([
      view({ id: 'acme.actions', data: () => ({ blocks: [] }), onAction: () => {} }),
    ])

    await expect(views.act('acme.actions', { action: 'noop', sessionId: null })).resolves.toBeNull()
  })

  it('reports a view with no handler instead of swallowing the press', async () => {
    // A button that silently does nothing is indistinguishable from a broken window.
    const views = runner([
      view({ id: 'acme.actions', title: '动作', data: () => ({ blocks: [] }) }),
    ])

    await expect(views.act('acme.actions', { action: 'press', sessionId: null })).rejects.toThrow(
      /视图「动作」没有处理按钮：press/,
    )
  })

  it('reports a handler that throws as that view failing', async () => {
    const views = runner([
      view({
        id: 'acme.actions',
        title: '动作',
        data: () => ({ blocks: [] }),
        onAction: () => {
          throw new Error('git 挂了')
        },
      }),
    ])

    await expect(views.act('acme.actions', { action: 'press', sessionId: null })).rejects.toThrow(
      /视图「动作」处理「press」时失败：git 挂了/,
    )
  })

  it('reports a malformed answer rather than drawing half of it', async () => {
    const views = runner([
      view({
        id: 'acme.actions',
        title: '动作',
        data: () => ({ blocks: [] }),
        onAction: () => ({ blocks: [{ kind: 'chart' }] }) as unknown as ViewSpec,
      }),
    ])

    await expect(views.act('acme.actions', { action: 'press', sessionId: null })).rejects.toThrow(
      /不符合契约：view\.blocks\[0\]\.kind is not one this window draws: chart/,
    )
  })

  it('gives up on a handler that never answers', async () => {
    const views = runner([
      view({
        id: 'acme.actions',
        title: '动作',
        data: () => ({ blocks: [] }),
        onAction: () => new Promise(() => {}),
      }),
    ])

    await expect(views.act('acme.actions', { action: 'press', sessionId: null })).rejects.toThrow(
      /视图「动作」处理「press」时失败：.*没有回答/,
    )
  })

  it('refuses a press on a view nobody contributed', async () => {
    await expect(runner([]).act('acme.nope', { action: 'press', sessionId: null })).rejects.toThrow(
      /没有这个视图：acme.nope/,
    )
  })
})

/**
 * A frame view is not run here: the window runs it. What this process owns is the address
 * its files are served from, and the refusal when the plugin that owns them is gone.
 */
describe('PluginViews.render — frames', () => {
  const board: ViewContribution = {
    id: 'acme.board',
    title: '看板',
    frame: { entry: 'client/index.js', styles: 'client/index.css' },
  }

  it('mounts the bundle and says where it is', async () => {
    const host = frames()
    const render = await framed([board], { frames: host }).render('acme.board', {
      sessionId: 's1',
    })

    expect(render).toEqual({ kind: 'frame', url: 'http://127.0.0.1:9/f/token/', title: '看板' })
    // The address is mounted for one view of one conversation, inside that plugin's root.
    expect(host.mount).toHaveBeenCalledWith({
      viewId: 'acme.board',
      pluginId: 'acme.demo',
      root: '/plugins/acme.demo',
      entry: 'client/index.js',
      styles: 'client/index.css',
      sessionId: 's1',
    })
  })

  it('names the plugin whose files are gone', async () => {
    // Serving from a remembered path after an uninstall would hand the window whatever
    // moved into that directory.
    await expect(
      framed([board], { root: null }).render('acme.board', { sessionId: null }),
    ).rejects.toThrow(/插件目录不在了：acme.demo/)
  })

  it('says so when this build cannot run a frame', async () => {
    await expect(
      framed([board], { frames: null }).render('acme.board', { sessionId: null }),
    ).rejects.toThrow(/没有帧宿主/)
  })
})

/**
 * A message from a frame is the plugin's own conversation with its front end. The three
 * answers that matter: data, nothing, and the plugin's own words when it fails.
 */
describe('PluginViews.respond', () => {
  const board = (respond: ViewContribution['respond']): ViewContribution => ({
    id: 'acme.board',
    title: '看板',
    frame: { entry: 'client.js' },
    ...(respond === undefined ? {} : { respond }),
  })

  it('answers with what the plugin returned', async () => {
    const views = framed([board(({ action, value }) => ({ action, value, ok: true }))])

    await expect(
      views.respond('acme.board', { action: 'load', value: 'x', sessionId: 's1' }),
    ).resolves.toEqual({ ok: true, data: { action: 'load', value: 'x', ok: true } })
  })

  it('answers null when the plugin said nothing', async () => {
    const views = framed([board(() => undefined)])

    await expect(views.respond('acme.board', { action: 'noop', sessionId: null })).resolves.toEqual(
      {
        ok: true,
        data: null,
      },
    )
  })

  it('reports a plugin that throws in its own words', async () => {
    const views = framed([
      board(() => {
        throw new Error('数据库没打开')
      }),
    ])

    const answer = await views.respond('acme.board', { action: 'load', sessionId: null })

    expect(answer).toEqual({
      ok: false,
      error: '视图「看板」处理「load」时失败：数据库没打开',
    })
  })

  it('refuses an answer that is not JSON', async () => {
    // Without this the frame would receive `{}` and read it as an empty answer.
    const views = framed([board(() => 10n)])

    await expect(
      views.respond('acme.board', { action: 'load', sessionId: null }),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/不是 JSON/) as unknown as string,
    })
  })

  it('refuses an answer larger than a message may carry', async () => {
    const views = framed([board(() => 'x'.repeat(VIEW_LIMITS.answer + 1))])

    await expect(
      views.respond('acme.board', { action: 'load', sessionId: null }),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/答复超过/) as unknown as string,
    })
  })

  it('reports a view that has no handler', async () => {
    const views = framed([board(undefined)])

    await expect(views.respond('acme.board', { action: 'load', sessionId: null })).resolves.toEqual(
      {
        ok: false,
        error: '视图「看板」不处理消息：load',
      },
    )
  })

  it('reports a view nobody contributed', async () => {
    await expect(
      framed([]).respond('acme.nope', { action: 'load', sessionId: null }),
    ).resolves.toEqual({ ok: false, error: '没有这个视图：acme.nope' })
  })
})
