import {
  ViewSpecError,
  parseViewSpec,
  type ViewContext,
  type ViewContribution,
} from '@pictor/plugin-sdk'

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

  constructor(
    views: readonly ViewContribution[],
    options: { dataDirectory: (pluginId: string) => string; timeoutMs?: number },
  ) {
    this.#views = views
    this.#dataDirectory = options.dataDirectory
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
  async render(id: string, context: { sessionId: string | null }): Promise<unknown> {
    const view = this.#views.find((entry) => entry.id === id)
    if (view === undefined) throw new Error(`没有这个视图：${id}`)

    const owner = this.#ownerOf(id)
    const call: ViewContext = {
      sessionId: context.sessionId,
      dataDirectory: this.#dataDirectory(owner),
      pluginId: owner,
    }

    let answered: unknown
    try {
      answered = await withTimeout(Promise.resolve(view.data(call)), this.#timeoutMs, view.id)
    } catch (error) {
      // The plugin's own failure is reported as its failure: a panel that said "加载失败"
      // without saying whose would send someone looking in the wrong place.
      throw new Error(`视图「${view.title}」没有产出内容：${messageOf(error)}`)
    }

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
