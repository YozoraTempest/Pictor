import {
  VIEW_LIMITS,
  ViewSpecError,
  parseViewSpec,
  type ViewContext,
  type ViewContribution,
  type ViewSpec,
} from '@vulonlok/plugin-sdk'

import type { FrameHost } from './frame-host.js'

/**
 * What the window draws for one view.
 *
 * Two payloads, because a view has two: a description it draws itself, or a bundle it runs
 * in a sandboxed frame. Naming it as a union here means the renderer cannot forget one —
 * the compiler asks which kind it got before it can draw anything.
 */
export type ViewRender =
  { kind: 'blocks'; spec: ViewSpec } | { kind: 'frame'; url: string; title: string }

/** The answer one frame message gets back, as the frame sees it. */
export type FrameAnswer = { ok: true; data: unknown } | { ok: false; error: string }

/**
 * The main-process half of a plugin view: call the plugin, check what came back.
 *
 * The window never calls plugin code. It asks for a view by id, and this runs the
 * contribution's `data` in the process the plugin already lives in, validates the answer
 * block by block, and hands back a description. Two properties follow from that and both
 * are the point: a plugin cannot reach into the renderer, and a malformed answer is named
 * as such instead of being drawn half way.
 */
export class PluginViews {
  readonly #views: readonly ViewContribution[]
  readonly #dataDirectory: (pluginId: string) => string
  /** Fails a view that never answers; a panel must not wait forever on one. */
  readonly #timeoutMs: number

  /** Where a plugin's files are, for a view that ships one instead of describing itself. */
  readonly #pluginRoot: (pluginId: string) => string | null
  /** Serves a frame's files. Absent means this build cannot run one, and says so. */
  readonly #frames: FrameHost | null

  constructor(
    views: readonly ViewContribution[],
    options: {
      dataDirectory: (pluginId: string) => string
      pluginRoot?: (pluginId: string) => string | null
      frames?: FrameHost
      timeoutMs?: number
    },
  ) {
    this.#views = views
    this.#dataDirectory = options.dataDirectory
    this.#pluginRoot = options.pluginRoot ?? ((): null => null)
    this.#frames = options.frames ?? null
    this.#timeoutMs = options.timeoutMs ?? 5_000
  }

  /** The views this build has, in contribution order. */
  list(): readonly ViewContribution[] {
    return this.#views
  }

  has(id: string): boolean {
    return this.#views.some((view) => view.id === id)
  }

  /**
   * Renders one view by running its plugin function.
   *
   * The owner of a view is looked up from the contribution list rather than passed in, so
   * a caller cannot name a `dataDirectory` of its choosing — the plugin's own directory is
   * the one thing a view is handed that it did not ask for.
   */
  async render(id: string, context: { sessionId: string | null }): Promise<ViewRender> {
    const view = this.#views.find((entry) => entry.id === id)
    if (view === undefined) throw new Error(`没有这个视图：${id}`)

    const owner = this.#ownerOf(id)
    const call: ViewContext = {
      sessionId: context.sessionId,
      dataDirectory: this.#dataDirectory(owner),
      pluginId: owner,
    }

    // A bundle is not run here: the window runs it in a frame, and this only says where
    // its files are. Mounting is deferred to the moment a panel actually opens, because a
    // URL nobody loads should not exist.
    if (view.frame !== undefined) {
      const root = this.#pluginRoot(owner)
      if (root === null) {
        throw new Error(`视图「${view.title}」的插件目录不在了：${owner}`)
      }
      if (this.#frames === null) {
        throw new Error('这个构建没有帧宿主，装不了带前端的视图')
      }
      const mounted = await this.#frames.mount({
        viewId: view.id,
        pluginId: owner,
        root,
        entry: view.frame.entry,
        ...(view.frame.styles === undefined ? {} : { styles: view.frame.styles }),
        sessionId: context.sessionId,
      })
      return { kind: 'frame', url: mounted.url, title: view.title }
    }

    if (view.data === undefined) throw new Error(`视图「${view.title}」没有内容`)

    let answered: unknown
    try {
      answered = await withTimeout(Promise.resolve(view.data(call)), this.#timeoutMs, view.id)
    } catch (error) {
      // The plugin's own failure is reported as its failure: a panel that said "加载失败"
      // without saying whose would send someone looking in the wrong place.
      throw new Error(`视图「${view.title}」没有产出内容：${messageOf(error)}`)
    }

    try {
      return { kind: 'blocks', spec: parseViewSpec(answered) }
    } catch (error) {
      throw new Error(
        `视图「${view.title}」返回的内容不符合契约：${error instanceof ViewSpecError ? error.message : messageOf(error)}`,
      )
    }
  }

  /**
   * Answers one message from a frame.
   *
   * Never throws on the plugin's behalf: the caller is a `postMessage` channel inside the
   * plugin's own front end, and the only useful thing to send back is either data or the
   * plugin's own words. A failure that arrived as a rejected IPC call would land in the
   * host's error banner instead of where the person is looking.
   *
   * The answer has to survive JSON, because it crosses into another process as such. That
   * is checked here rather than assumed: a plugin returning a `Map` would otherwise reach
   * the frame as `{}` and look like an empty answer.
   */
  async respond(
    id: string,
    request: { action: string; value?: string; sessionId: string | null },
  ): Promise<FrameAnswer> {
    const view = this.#views.find((entry) => entry.id === id)
    if (view === undefined) return { ok: false, error: `没有这个视图：${id}` }
    if (view.respond === undefined) {
      return { ok: false, error: `视图「${view.title}」不处理消息：${request.action}` }
    }

    const owner = this.#ownerOf(id)
    const call = {
      sessionId: request.sessionId,
      dataDirectory: this.#dataDirectory(owner),
      pluginId: owner,
      action: request.action,
      ...(request.value === undefined ? {} : { value: request.value }),
    }

    let answered: unknown
    try {
      answered = await withTimeout(Promise.resolve(view.respond(call)), this.#timeoutMs, view.id)
    } catch (error) {
      return {
        ok: false,
        error: `视图「${view.title}」处理「${request.action}」时失败：${messageOf(error)}`,
      }
    }

    // Nothing to say is an answer: the frame gets `null` rather than waiting forever.
    if (answered === undefined) return { ok: true, data: null }

    let json: string
    try {
      json = JSON.stringify(answered) ?? 'null'
    } catch (error) {
      return { ok: false, error: `视图「${view.title}」的答复不是 JSON：${messageOf(error)}` }
    }
    if (json.length > VIEW_LIMITS.answer) {
      return {
        ok: false,
        error: `视图「${view.title}」的答复超过 ${String(VIEW_LIMITS.answer)} 字节`,
      }
    }

    return { ok: true, data: JSON.parse(json) as unknown }
  }

  /**
   * Runs one button press and answers with what to draw next.
   *
   * The click is a message, not code: the plugin's `onAction` runs here, next to the
   * plugin, and the window only ever receives a description back. Returning nothing means
   * the press changed nothing visible, and the panel keeps what it has — no flash, no
   * empty frame.
   */
  async act(
    id: string,
    request: { action: string; value?: string; sessionId: string | null },
  ): Promise<unknown | null> {
    const view = this.#views.find((entry) => entry.id === id)
    if (view === undefined) throw new Error(`没有这个视图：${id}`)
    if (view.onAction === undefined) {
      throw new Error(`视图「${view.title}」没有处理按钮：${request.action}`)
    }

    const owner = this.#ownerOf(id)
    const call = {
      sessionId: request.sessionId,
      dataDirectory: this.#dataDirectory(owner),
      pluginId: owner,
      action: request.action,
      ...(request.value === undefined ? {} : { value: request.value }),
    }

    let answered: unknown
    try {
      answered = await withTimeout(Promise.resolve(view.onAction(call)), this.#timeoutMs, view.id)
    } catch (error) {
      throw new Error(`视图「${view.title}」处理「${request.action}」时失败：${messageOf(error)}`)
    }

    // Nothing returned is an answer too: the press happened, the panel stays as it is.
    if (answered === undefined) return null

    try {
      return parseViewSpec(answered)
    } catch (error) {
      throw new Error(
        `视图「${view.title}」返回的内容不符合契约：${error instanceof ViewSpecError ? error.message : messageOf(error)}`,
      )
    }
  }

  /** The plugin that contributed one view. */
  #ownerOf(id: string): string {
    return this.#owners.get(id) ?? id
  }

  /** Filled by {@link withOwners}; a view's plugin id is not part of its payload. */
  readonly #owners = new Map<string, string>()

  /** Records which plugin contributed each view, for the data directory. */
  withOwners(owners: ReadonlyMap<string, string>): this {
    for (const [id, pluginId] of owners) this.#owners.set(id, pluginId)
    return this
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Rejects with a sentence naming the view when a plugin never answers. */
async function withTimeout<T>(work: Promise<T>, timeoutMs: number, id: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`视图 ${id} 在 ${String(timeoutMs)}ms 内没有回答`))
        }, timeoutMs)
        ;(timer as { unref?: () => void }).unref?.()
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
