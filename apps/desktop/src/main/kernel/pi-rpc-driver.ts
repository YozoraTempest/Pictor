import { spawn, type ChildProcess } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'

import type { HarnessNotification } from '@pictor/harness'
import type {
  CatalogSkill,
  ChatHistoryPage,
  ChatImage,
  ForkPoint,
  ModelEffort,
} from '@pictor/shared'

import type {
  HarnessStatus,
  KernelCapabilities,
  KernelModel,
  KernelModelList,
  PermissionMode,
} from '../../shared/bridge.js'
import type { AgentProbeResult, KernelDriver } from './driver.js'
import type { KernelModelSource } from './model-source.js'
import { PiTranslator, type PiFrame } from './pi-events.js'
import { historyRows, textOf, type StoredRecord } from './pi-history.js'

/** How long one command may take before the caller gives up on Pi answering. */
const REQUEST_TIMEOUT_MS = 30_000
/** How long a stopping child gets to leave on its own. */
const SHUTDOWN_GRACE_MS = 2_000
/** Entry points this driver runs with its own runtime instead of executing directly. */
const SCRIPT = /\.[cm]?js$/i

/** How many history rows one page opens with. */
const HISTORY_PAGE = 50

export interface PiRpcDriverOptions {
  userData: string
  /** Directory a conversation runs in, resolved from its project. */
  resolveCwd: (sessionId: string) => Promise<string | null>
  /**
   * Pi's CLI entry point, run by {@link PiRpcDriverOptions.runtime}.
   *
   * Defaults to whatever `pi` on PATH resolves to; `PICTOR_PI_BIN` names one
   * explicitly, which is also how a wrapper can be inspected.
   */
  script?: string
  /** Interpreter used to run the script; defaults to this process's own runtime. */
  runtime?: string
  /**
   * Writes (or refreshes) Pictor's guard extension and returns its path.
   *
   * Called once per child: the file carries the bridge's port and token, so a stale
   * one would block every tool call. A null path means no guard is available.
   */
  guardExtension?: () => string | null
}

/** One Pi child process, and everything owed to it. */
interface Kid {
  sessionId: string
  proc: ChildProcess
  buffer: string
  stderr: string
  /** Commands waiting for their matching `response` record. */
  pending: Map<string, { resolve: (data: unknown) => void; reject: (error: Error) => void }>
  translator: PiTranslator | null
  /** Turn number of the run in flight, or null when idle. */
  turn: number | null
  /** The model Pi is running, as of the last `get_state`. */
  model: { id: string; name: string; provider: string | null; input: string[]; key: string } | null
  /** Where Pi is writing this conversation, once it says so. */
  sessionFile: string | null
  /** Set once the child is known to answer commands. */
  ready: Promise<void> | null
}

interface RpcResponse {
  id?: unknown
  type?: unknown
  success?: unknown
  data?: unknown
  error?: unknown
}

/**
 * Pi as a kernel, driven over its RPC protocol.
 *
 * Pi has no server: `pi --mode rpc` keeps one agent alive and takes JSONL commands
 * on stdin, answering with responses and a live event stream. That is the shape
 * this driver uses — one child per conversation, so two conversations cannot
 * interleave inside one process, and a crash costs one conversation instead of
 * the window.
 *
 * The child runs on **this process's own runtime** (`ELECTRON_RUN_AS_NODE`), not on
 * whatever `node` happens to be on PATH: Pi needs Node 22.19 or newer, and a
 * desktop app cannot rely on the machine's default Node being that new.
 *
 * What it can do: send a message with images, stream the answer and its thinking,
 * run tools, report usage, cancel, resume a session, read a session back. What it
 * cannot yet: hold a tool call for an approval (Pi's extension hook would be the
 * seam), set a sandbox per conversation, or branch at a message — those arrive
 * with their own work, and until then the driver says so instead of faking it.
 */
export class PiRpcDriver implements KernelDriver, KernelModelSource {
  readonly id = 'pi'
  /**
   * Pi answers for its own models and branches its own conversations; it still
   * decides the sandbox and the skill catalog itself.
   */
  readonly capabilities: KernelCapabilities = {
    permission: false,
    model: true,
    skills: false,
    fork: true,
  }

  readonly #options: PiRpcDriverOptions
  readonly #listeners = new Set<(notification: HarnessNotification) => void>()
  /** One child per conversation, started on first use. */
  readonly #kids = new Map<string, Kid>()
  /**
   * Children whose conversation has not been adopted yet.
   *
   * A fork leaves the child running the *branch*, while the Pictor session for that
   * branch does not exist until the caller creates it. Holding it here by the
   * kernel's own id lets {@link adopt} hand it over instead of throwing away a live
   * session that already has the right history.
   */
  readonly #orphans = new Map<string, Kid>()
  /** Turn counter per conversation; the run id the window keys its stream on. */
  readonly #turns = new Map<string, number>()
  /** Pictor session id → Pi session id; persisted so a restart can resume. */
  readonly #sessions = new Map<string, string>()
  /** Pictor session id → chosen model key; persisted so a restart keeps it. */
  readonly #models = new Map<string, string>()
  /** Pi's catalogue, read once per app run: it changes when Pi does. */
  #catalogue: KernelModel[] | null = null
  #sessionsLoaded = false
  #cwd: string | null = null
  #nextRequest = 0

  constructor(options: PiRpcDriverOptions) {
    this.#options = options
  }

  // ---- lifecycle -----------------------------------------------------------

  /** Nothing to boot here: each conversation starts its own child when prompted. */
  async start(cwd: string): Promise<HarnessStatus> {
    this.#cwd = cwd
    this.#loadSessions()
    this.#loadModels()
    return this.status()
  }

  async stop(): Promise<HarnessStatus> {
    const kids = [...this.#kids.values(), ...this.#orphans.values()]
    this.#kids.clear()
    this.#orphans.clear()
    for (const kid of kids) this.#closeTurn(kid, { reason: 'stopped' })
    await Promise.all(kids.map((kid) => this.#shutdown(kid)))
    return this.status()
  }

  /**
   * Whether this machine can run Pi at all, and which version.
   *
   * A CLI-shaped kernel has no state between turns, so "ready" can only mean the
   * script is here. The check runs per call, so installing Pi while the window is
   * open shows up on the next look.
   */
  status(): HarnessStatus {
    const script = this.#script()
    return {
      state: script === null ? 'error' : 'ready',
      binary: script,
      version: script === null ? null : packageVersion(script),
      expectedVersion: null,
      home: this.#sessionDirectory(),
      provider: null,
      model: null,
      serverInfo: null,
      permissionMode: 'workspace-write',
      error: script === null ? '没有找到 pi 可执行文件，先安装再试' : null,
    }
  }

  /**
   * Pi installs itself: `npm i -g @earendil-works/pi-coding-agent`.
   *
   * This driver will not run a package manager on the user's behalf — the command
   * differs per platform, per package manager and per version, and a silent global
   * install is not something a settings toggle should do.
   */
  async install(): Promise<HarnessStatus> {
    throw new Error('Pi 需要自行安装：npm i -g @earendil-works/pi-coding-agent')
  }

  onNotification(listener: (notification: HarnessNotification) => void): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  // ---- conversations -------------------------------------------------------

  async prompt(
    sessionId: string,
    text: string,
    images: readonly ChatImage[] = [],
    effort: ModelEffort | null = null,
  ): Promise<void> {
    const kid = await this.#ensure(sessionId)
    if (kid.turn !== null) throw new Error('上一轮还没有结束，等它跑完或者先停止')

    if (images.length > 0) {
      // A model that cannot see pictures drops them without a word, and the window
      // would show a confident answer about an image nobody looked at. Pi says
      // which model it runs and whether it takes images; ask before spending one.
      const model = kid.model ?? (await this.#readState(kid))
      if (model !== null && !model.input.includes('image')) {
        throw new Error(
          `${model.name || model.id} 不接受图片（pi 当前模型），在 pi 里换成支持图片的模型再发`,
        )
      }
    }

    // The level travels as a command, not a flag: the process outlives the turn.
    if (effort !== null) {
      await this.#request(kid, { type: 'set_thinking_level', level: effort }).catch(() => undefined)
    }

    const turn = this.#openTurn(kid)
    try {
      const accepted = await this.#request(kid, {
        type: 'prompt',
        message: text,
        ...(images.length === 0
          ? {}
          : {
              images: images.map((image) => ({
                type: 'image',
                data: image.data,
                mimeType: image.mediaType,
              })),
            }),
      })
      const failure = problemOf(accepted)
      if (failure !== null) throw new Error(failure)
    } catch (error) {
      // A prompt that never started must still close its turn: the window opened a
      // run when it sent, and would wait for a turn that is not coming.
      this.#closeTurn(kid, { reason: 'error', message: describe(error) }, turn)
      throw error
    }
  }

  async cancel(sessionId: string): Promise<void> {
    const kid = this.#kids.get(sessionId)
    if (kid === undefined || kid.turn === null) return
    kid.translator?.cancel()
    await this.#request(kid, { type: 'abort' }).catch(() => undefined)
  }

  /**
   * Branches the conversation at one of its user messages.
   *
   * Pi forks by entry id, so the point comes from a row's `forkId`; without one it
   * takes the newest forkable question, which is what "branch from here" means when
   * no message was picked. The fork happens inside the conversation's own process,
   * which then *is* the new branch — so this closes that process: the original
   * conversation keeps its file and starts a fresh one next time, and the branch is
   * adopted under its own id.
   */
  async fork(sessionId: string, at?: ForkPoint): Promise<string> {
    const kid = await this.#ensure(sessionId)

    let entryId = at?.id ?? null
    if (entryId === null) {
      if (at?.seq !== undefined) {
        throw new Error('这个内核按消息分叉，不认事件序号')
      }
      const data = (await this.#request(kid, { type: 'get_fork_messages' })) as {
        messages?: unknown
      } | null
      const list = Array.isArray(data?.messages) ? data.messages : []
      const last = list.at(-1) as Record<string, unknown> | undefined
      entryId = typeof last?.['entryId'] === 'string' ? last['entryId'] : null
      if (entryId === null) throw new Error('这个会话还没有可以分叉的消息')
    }

    const answer = (await this.#request(kid, { type: 'fork', entryId })) as {
      cancelled?: unknown
    } | null
    if (answer?.cancelled === true) throw new Error('pi 取消了这次分叉')

    // The child is now running the branch: read its identity, then let it go so the
    // original conversation can start its own process from its untouched file.
    const state = (await this.#request(kid, { type: 'get_state' })) as {
      sessionId?: unknown
    } | null
    const forked = typeof state?.sessionId === 'string' ? state.sessionId : null
    if (forked === null) throw new Error('pi 分叉后没有给出新会话的 id')

    // The child now runs the branch. Keep it (the caller adopts it in a moment) and
    // let the original conversation start a fresh process from its untouched file.
    this.#kids.delete(sessionId)
    kid.sessionId = forked
    kid.turn = null
    kid.translator = null
    this.#orphans.set(forked, kid)
    return forked
  }

  // ---- models, in Pi's own words --------------------------------------------

  /**
   * Pi's catalogue, with the conversation's current choice.
   *
   * The list comes from a throwaway child (`--no-session`): opening a picker must
   * not start the conversation's process, and Pi's catalogue only changes when Pi
   * does, so one read serves the whole app run.
   */
  async models(sessionId: string): Promise<KernelModelList> {
    const models = await this.#catalogueOf()
    const live = this.#kids.get(sessionId)
    const running = live?.model?.key ?? null
    return { models, activeId: this.#models.get(sessionId) ?? running }
  }

  /**
   * Switches the conversation's model.
   *
   * A running child is told immediately; a conversation that has not started keeps
   * the choice and is launched with it, so the picker means the same thing either
   * way.
   */
  async selectModel(sessionId: string, id: string): Promise<void> {
    const model = (await this.#catalogueOf()).find((entry) => entry.id === id)
    if (model === undefined) throw new Error(`pi 没有这个模型：${id}`)

    this.#models.set(sessionId, id)
    this.#persistModels()

    const kid = this.#kids.get(sessionId)
    if (kid === undefined || kid.proc.exitCode !== null) return
    await this.#request(kid, {
      type: 'set_model',
      ...(model.provider === null ? {} : { provider: model.provider }),
      modelId: model.id.split('/').at(-1) ?? model.id,
    })
  }

  adopt(sessionId: string, kernelSessionId: string): void {
    this.#loadSessions()
    this.#sessions.set(sessionId, kernelSessionId)
    this.#persistSessions()

    // A fork left its child running the branch; this is where that branch gets its
    // Pictor identity, so the live process becomes its child instead of a stranger.
    const orphan = this.#orphans.get(kernelSessionId)
    if (orphan === undefined) return
    this.#orphans.delete(kernelSessionId)
    orphan.sessionId = sessionId
    this.#kids.set(sessionId, orphan)
  }

  // ---- history -------------------------------------------------------------

  async openHistory(sessionId: string): Promise<ChatHistoryPage> {
    return this.historyPage(sessionId, HISTORY_PAGE, 0)
  }

  /**
   * Reads the conversation back from Pi's own session file.
   *
   * Pictor keeps no transcript of its own, so the file is the record: every
   * message Pi appended becomes a row, tool calls included, and a tool's output
   * lands on the row its call opened so a reload looks like the live transcript.
   */
  async historyPage(sessionId: string, limit: number, offset: number): Promise<ChatHistoryPage> {
    const messages = historyRows(await this.#entries(sessionId))

    // Newest last, and a page is the tail of the conversation.
    const end = Math.max(0, messages.length - Math.max(0, offset))
    const start = Math.max(0, end - Math.max(1, limit))
    return {
      messages: messages.slice(start, end),
      nextOffset: messages.length - start,
      hasMore: start > 0,
    }
  }

  /**
   * The conversation's stored entries.
   *
   * A live child is asked: Pi buffers the session file, so reading it right after a
   * turn would show a conversation that has not been written yet. The file is the
   * cold path — reopening a conversation with no process to ask.
   */
  async #entries(sessionId: string): Promise<StoredRecord[]> {
    const kid = this.#kids.get(sessionId)
    if (kid !== undefined && kid.proc.exitCode === null) {
      try {
        const data = (await this.#request(kid, { type: 'get_entries' })) as {
          entries?: unknown
        } | null
        if (Array.isArray(data?.entries)) return data.entries as StoredRecord[]
      } catch {
        // Fall through to the file: a history read must not fail because Pi became
        // busy or died mid-request.
      }
    }
    return this.#records(sessionId)
  }

  /** The file's lines, or nothing when there is no file to read yet. */
  #records(sessionId: string): StoredRecord[] {
    this.#loadSessions()
    const reported = this.#kids.get(sessionId)?.sessionFile ?? null
    let file = reported !== null && existsSync(reported) ? reported : null
    if (file === null) {
      const kernelSession = this.#sessions.get(sessionId)
      if (kernelSession === undefined) return []
      file = this.#sessionFile(kernelSession)
    }
    if (file === null) return []

    try {
      return readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line): StoredRecord[] => {
          const trimmed = line.trim()
          if (trimmed.length === 0) return []
          try {
            return [JSON.parse(trimmed) as StoredRecord]
          } catch {
            return []
          }
        })
    } catch {
      return []
    }
  }

  // ---- what Pi cannot express ---------------------------------------------

  /** Pi runs with the permissions of the account that started it; it reports none. */
  async sessionPermission(): Promise<string | null> {
    return null
  }

  async setSessionPermission(): Promise<void> {
    throw new Error('Pi 内核不支持按会话切换沙箱；它用启动它的账号权限运行')
  }

  setPermissionMode(_mode: PermissionMode): void {
    // Recorded by the caller for the next conversation; Pi reads none of it.
  }

  async applyPermission(): Promise<void> {
    // Nothing to apply: Pi has no sandbox of its own.
  }

  async applySettings(): Promise<void> {
    // A child reads its settings when it starts; a new conversation gets them.
  }

  async projectRootFor(sessionId: string): Promise<string | null> {
    const start = (await this.#options.resolveCwd(sessionId)) ?? this.#cwd
    if (start === null) return null
    let current = start
    for (;;) {
      if (existsSync(join(current, '.git'))) return current
      const parent = join(current, '..')
      if (parent === current) return null
      current = parent
    }
  }

  /** Pi loads skills from disk but exposes no catalog over RPC; it lists none. */
  async listSkills(): Promise<CatalogSkill[]> {
    return []
  }

  async answerApproval(): Promise<void> {
    throw new Error('Pi 内核没有需要审批的工具调用')
  }

  async answerQuestions(): Promise<void> {
    throw new Error('Pi 内核不能在对话中途提问')
  }

  /** One throwaway run, for the diagnosis button. */
  async probe(prompt: string, cwd: string): Promise<AgentProbeResult> {
    const [command, args] = this.#invocation(['-p', '--mode', 'json', prompt])
    if (command === null) {
      return { ok: false, text: '', events: [], message: '没有找到 pi 可执行文件' }
    }

    const result = await new Promise<{ text: string; error: string | null }>((resolve) => {
      const child = spawn(command, args, {
        cwd,
        env: { ...process.env, ...this.#runtimeEnv() },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let out = ''
      let err = ''
      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        out += chunk
      })
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (chunk: string) => {
        err += chunk
      })
      child.on('error', (error) => resolve({ text: '', error: error.message }))
      child.on('exit', (code) => {
        const text = out
          .split('\n')
          .flatMap((line): string[] => {
            const trimmed = line.trim()
            if (trimmed.length === 0) return []
            try {
              const record = JSON.parse(trimmed) as Record<string, unknown>
              const message = record['message'] as { role?: unknown; content?: unknown } | null
              return record['type'] === 'message' && message?.role === 'assistant'
                ? [textOf(message.content)]
                : []
            } catch {
              return []
            }
          })
          .join('')
        resolve({ text, error: code === 0 ? null : err.trim().split('\n').slice(-2).join(' ') })
      })
    })

    return {
      ok: result.error === null,
      text: result.text,
      events: [],
      ...(result.error === null ? {} : { message: result.error }),
    }
  }

  // ---- the child process ---------------------------------------------------

  /** Starts a conversation's child if it has none, and waits until it answers. */
  async #ensure(sessionId: string): Promise<Kid> {
    const existing = this.#kids.get(sessionId)
    if (existing !== undefined && existing.proc.exitCode === null && !existing.proc.killed) {
      await (existing.ready ?? Promise.resolve())
      return existing
    }

    const [command, args] = this.#invocation([], sessionId)
    if (command === null) throw new Error('没有找到 pi 可执行文件，先安装再试')

    const cwd = (await this.#options.resolveCwd(sessionId)) ?? this.#cwd ?? homedir()
    const proc = spawn(command, args, {
      cwd,
      env: { ...process.env, ...this.#runtimeEnv() },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const kid: Kid = {
      sessionId,
      proc,
      buffer: '',
      stderr: '',
      pending: new Map(),
      translator: null,
      turn: null,
      model: null,
      sessionFile: null,
      ready: null,
    }
    this.#kids.set(sessionId, kid)

    proc.stdout?.setEncoding('utf8')
    proc.stdout?.on('data', (data: string) => {
      kid.buffer += data
      this.#drain(kid)
    })
    proc.stderr?.setEncoding('utf8')
    proc.stderr?.on('data', (data: string) => {
      // Enough to explain an exit without holding a whole log in memory.
      kid.stderr = `${kid.stderr}${data}`.slice(-2_000)
    })
    proc.on('error', (error) => {
      this.#failPending(kid, error.message)
      this.#closeTurn(kid, { reason: 'error', message: error.message })
      this.#kids.delete(sessionId)
    })
    proc.on('exit', (code) => {
      const failure = `pi 进程退出（${code === null ? '信号' : `退出码 ${String(code)}`}）`
      this.#failPending(kid, failure)
      this.#closeTurn(kid, { reason: 'error', message: `${failure}${tail(kid.stderr)}` })
      this.#kids.delete(sessionId)
    })

    // The handshake is also the model read: a child that cannot answer `get_state`
    // is not a child worth prompting.
    kid.ready = (async () => {
      await this.#readState(kid)
    })()
    try {
      await kid.ready
    } catch (error) {
      await this.#shutdown(kid)
      this.#kids.delete(sessionId)
      throw error
    }
    return kid
  }

  #drain(kid: Kid): void {
    for (;;) {
      const newline = kid.buffer.indexOf('\n')
      if (newline === -1) return
      const line = kid.buffer.slice(0, newline).replace(/\r$/, '')
      kid.buffer = kid.buffer.slice(newline + 1)
      if (line.trim().length === 0) continue

      let record: Record<string, unknown>
      try {
        record = JSON.parse(line) as Record<string, unknown>
      } catch {
        // Stdout is protocol-only; a line that is not JSON is worth keeping for a
        // failure reason rather than dropping on the floor.
        kid.stderr = `${kid.stderr}${line}\n`.slice(-2_000)
        continue
      }

      const type = typeof record['type'] === 'string' ? record['type'] : ''
      if (type === 'response') {
        this.#settle(kid, record as RpcResponse)
        continue
      }

      // Session events describe activity, not one request.
      const read = kid.translator?.push(record) ?? { frames: [] }
      if (read.sessionId !== undefined && this.#sessions.get(kid.sessionId) !== read.sessionId) {
        this.#sessions.set(kid.sessionId, read.sessionId)
        this.#persistSessions()
      }
      for (const frame of read.frames) this.#emitFrame(kid.sessionId, frame)

      if (type === 'agent_settled') {
        void this.#closeSettled(kid)
      }
    }
  }

  #settle(kid: Kid, response: RpcResponse): void {
    const id = typeof response.id === 'string' ? response.id : null
    if (id === null) return
    const waiting = kid.pending.get(id)
    if (waiting === undefined) return
    kid.pending.delete(id)
    if (response.success === true) waiting.resolve(response.data)
    else waiting.reject(new Error(problemOf(response) ?? 'pi 拒绝了这个命令'))
  }

  #failPending(kid: Kid, message: string): void {
    for (const [id, waiting] of kid.pending) {
      kid.pending.delete(id)
      waiting.reject(new Error(message))
    }
  }

  /** Sends one command and resolves with its `response.data`. */
  #request(kid: Kid, command: Record<string, unknown>): Promise<unknown> {
    const id = `pictor-${String((this.#nextRequest += 1))}`
    if (kid.proc.stdin === null || kid.proc.stdin.destroyed) {
      return Promise.reject(new Error('pi 进程已经结束'))
    }

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        kid.pending.delete(id)
        reject(
          new Error(
            `pi 没有回应 ${String(command['type'])}（${String(REQUEST_TIMEOUT_MS / 1000)} 秒）`,
          ),
        )
      }, REQUEST_TIMEOUT_MS)

      kid.pending.set(id, {
        resolve: (data) => {
          clearTimeout(timer)
          resolve(data)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      kid.proc.stdin?.write(`${JSON.stringify({ id, ...command })}\n`)
    })
  }

  /** Reads Pi's model, so an image can be refused before it is dropped. */
  async #readState(kid: Kid): Promise<Kid['model']> {
    const data = (await this.#request(kid, { type: 'get_state' })) as {
      model?: Record<string, unknown>
      sessionId?: unknown
      sessionFile?: unknown
    } | null

    // Pi names its own session and where it writes it. Recording both means a
    // restart resumes the conversation even before the file has been flushed.
    const sessionId = typeof data?.sessionId === 'string' ? data.sessionId : null
    if (sessionId !== null && this.#sessions.get(kid.sessionId) !== sessionId) {
      this.#sessions.set(kid.sessionId, sessionId)
      this.#persistSessions()
    }
    if (typeof data?.sessionFile === 'string') kid.sessionFile = data.sessionFile

    const model = data?.model
    if (model === undefined || typeof model !== 'object' || model === null) return kid.model
    const input = Array.isArray(model['input'])
      ? model['input'].filter((entry): entry is string => typeof entry === 'string')
      : []
    const provider = typeof model['provider'] === 'string' ? model['provider'] : null
    const id = typeof model['id'] === 'string' ? model['id'] : ''
    kid.model = {
      id,
      name: typeof model['name'] === 'string' ? model['name'] : '',
      provider,
      input,
      key: modelKey(provider, id),
    }
    return kid.model
  }

  async #shutdown(kid: Kid): Promise<void> {
    if (kid.proc.exitCode !== null || kid.proc.killed) return
    await this.#request(kid, { type: 'shutdown' }).catch(() => undefined)
    const exited = new Promise<void>((resolve) => kid.proc.once('exit', () => resolve()))
    const timer = setTimeout(() => kid.proc.kill('SIGTERM'), SHUTDOWN_GRACE_MS)
    await exited
    clearTimeout(timer)
    if (kid.proc.exitCode === null) kid.proc.kill('SIGKILL')
  }

  // ---- one turn, as the window sees it -------------------------------------

  #openTurn(kid: Kid): number {
    const turn = (this.#turns.get(kid.sessionId) ?? 0) + 1
    this.#turns.set(kid.sessionId, turn)
    kid.turn = turn
    kid.translator = new PiTranslator()
    this.#emitFrame(kid.sessionId, { kind: 'event', type: 'turn/start', data: { turn } })
    return turn
  }

  /**
   * Closes a finished turn, with the fork point Pi just stored.
   *
   * Pi forks at a user message's entry id, and that entry exists only once the turn
   * is written. Reading it here is one cheap round trip, and the only way the
   * question a reader just asked can be branched from without reopening.
   */
  async #closeSettled(kid: Kid): Promise<void> {
    let forkId: string | undefined
    try {
      const data = (await this.#request(kid, { type: 'get_entries' })) as {
        entries?: unknown
      } | null
      const entries = Array.isArray(data?.entries) ? data.entries : []
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index] as {
          type?: unknown
          id?: unknown
          message?: { role?: unknown }
        }
        if (entry?.type !== 'message' || typeof entry.id !== 'string') continue
        if (entry.message?.role !== 'user') continue
        forkId = entry.id
        break
      }
    } catch {
      // A turn still closes without it; only the branch buttons lose a point.
    }
    this.#closeTurn(kid, { reason: 'settled' }, undefined, forkId)
  }

  /**
   * Closes the open turn, if there is one.
   *
   * Every path that ends a run comes through here — settled, aborted, the child
   * dying, a prompt that was never accepted — so the window always sees exactly one
   * `turn/end` for the run it opened.
   */
  #closeTurn(
    kid: Kid,
    outcome: { reason: 'settled' } | { reason: 'stopped' } | { reason: 'error'; message: string },
    expected?: number,
    forkId?: string,
  ): void {
    if (kid.turn === null) return
    if (expected !== undefined && kid.turn !== expected) return
    const translator = kid.translator ?? new PiTranslator()
    if (outcome.reason === 'stopped') translator.cancel()
    const frames = translator.finish({
      exitCode: 0,
      stderr: '',
      ...(outcome.reason === 'error' ? { failure: outcome.message } : {}),
      ...(forkId === undefined ? {} : { forkId }),
    })
    kid.turn = null
    kid.translator = null
    for (const frame of frames) this.#emitFrame(kid.sessionId, frame)
  }

  #emitFrame(sessionId: string, frame: PiFrame): void {
    const params =
      frame.kind === 'event'
        ? {
            sessionId,
            frame: {
              type: 'event',
              event: { type: frame.type, time: Date.now(), data: frame.data },
            },
          }
        : {
            sessionId,
            frame: { type: 'assistant-stream', frame: { type: 'chunk', chunk: frame.chunk } },
          }
    this.#emit({ method: 'session.follow', params })
  }

  #emit(notification: HarnessNotification): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(notification)
      } catch {
        // A broken listener must not break the turn for the others.
      }
    }
  }

  // ---- locating Pi ---------------------------------------------------------

  /**
   * How to start Pi: the interpreter and its arguments.
   *
   * The script is JavaScript, so it is run by this process's runtime rather than
   * by a shell lookup — that is what keeps the app independent of the machine's
   * default Node version.
   */
  #invocation(extra: readonly string[], sessionId?: string): readonly [string | null, string[]] {
    const script = this.#script()
    if (script === null) return [null, []]

    const args = [script, '--mode', 'rpc', '--session-dir', this.#sessionDirectory()]
    const known = sessionId === undefined ? undefined : this.#sessions.get(sessionId)
    if (known !== undefined) args.push('--session-id', known)
    // A conversation that has a chosen model starts on it: the picker has to mean
    // the same thing whether or not the process is already running.
    const chosen = sessionId === undefined ? undefined : this.#models.get(sessionId)
    if (chosen !== undefined) {
      const [provider, ...rest] = chosen.split('/')
      if (rest.length > 0 && provider !== undefined) {
        args.push('--provider', provider, '--model', rest.join('/'))
      } else {
        args.push('--model', chosen)
      }
    }
    const guard = this.#options.guardExtension?.() ?? null
    if (guard !== null) args.push('--extension', guard)
    args.push(...extra)

    // A native binary runs on its own; a JavaScript entry point needs the runtime.
    if (!SCRIPT.test(script)) return [script, [...extra]]
    return [this.#runtime(), args]
  }

  #runtimeEnv(): Record<string, string> {
    // `ELECTRON_RUN_AS_NODE` turns the app's own binary into a plain Node, so Pi
    // runs on the Node this app was built against.
    return { ELECTRON_RUN_AS_NODE: '1' }
  }

  #runtime(): string {
    return this.#options.runtime ?? process.execPath
  }

  /** The Pi entry point: explicit first, then whatever `pi` on PATH points at. */
  #script(): string | null {
    const explicit = this.#options.script ?? process.env['PICTOR_PI_BIN']
    if (explicit !== undefined && explicit.length > 0) {
      return existsSync(explicit) ? explicit : null
    }

    const path = process.env['PATH'] ?? ''
    for (const directory of path.split(delimiter)) {
      if (directory.length === 0) continue
      const candidate = join(directory, 'pi')
      if (!existsSync(candidate)) continue
      try {
        return realpathSync(candidate)
      } catch {
        return candidate
      }
    }
    return null
  }

  /**
   * Pi's model catalogue, read through a throwaway child.
   *
   * `--no-session` keeps the query from creating a conversation; the child is shut
   * down as soon as it answers. The result is cached for this app run.
   */
  async #catalogueOf(): Promise<KernelModel[]> {
    if (this.#catalogue !== null) return this.#catalogue

    const [command, args] = this.#invocation(['--no-session'])
    if (command === null) throw new Error('没有找到 pi 可执行文件，先安装再试')

    const proc = spawn(command, args, {
      cwd: this.#cwd ?? homedir(),
      env: { ...process.env, ...this.#runtimeEnv() },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let buffer = ''
    let stderr = ''
    proc.stderr?.setEncoding('utf8')
    proc.stderr?.on('data', (data: string) => {
      stderr = `${stderr}${data}`.slice(-1_000)
    })

    const answer = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('pi 没有回应模型列表')), REQUEST_TIMEOUT_MS)
      proc.stdout?.setEncoding('utf8')
      proc.stdout?.on('data', (data: string) => {
        buffer += data
        for (;;) {
          const newline = buffer.indexOf('\n')
          if (newline === -1) return
          const line = buffer.slice(0, newline).replace(/\r$/, '')
          buffer = buffer.slice(newline + 1)
          if (line.trim().length === 0) continue
          let record: Record<string, unknown>
          try {
            record = JSON.parse(line) as Record<string, unknown>
          } catch {
            continue
          }
          if (record['type'] === 'response' && record['command'] === 'get_available_models') {
            clearTimeout(timer)
            resolve(record['data'])
          }
        }
      })
      proc.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      proc.on('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`pi 查询模型后退出了（${String(code)}）${tail(stderr)}`))
      })
      proc.stdin?.write(
        `${JSON.stringify({ id: 'pictor-models', type: 'get_available_models' })}\n`,
      )
    })

    try {
      const data = (await answer) as { models?: unknown } | null
      const models = Array.isArray(data?.models)
        ? data.models.flatMap((entry): KernelModel[] => {
            if (typeof entry !== 'object' || entry === null) return []
            const model = entry as Record<string, unknown>
            const id = typeof model['id'] === 'string' ? model['id'] : ''
            if (id.length === 0) return []
            const provider = typeof model['provider'] === 'string' ? model['provider'] : null
            const input = Array.isArray(model['input'])
              ? model['input'].filter((value): value is string => typeof value === 'string')
              : []
            const window = model['contextWindow']
            return [
              {
                id: modelKey(provider, id),
                label: typeof model['name'] === 'string' ? model['name'] : id,
                provider,
                images: input.includes('image'),
                contextWindow:
                  typeof window === 'number' && Number.isFinite(window) ? window : null,
              },
            ]
          })
        : []
      this.#catalogue = models
      return models
    } finally {
      proc.kill('SIGTERM')
    }
  }

  #modelsFile(): string {
    return join(this.#options.userData, 'pi-models.json')
  }

  #loadModels(): void {
    try {
      const parsed = JSON.parse(readFileSync(this.#modelsFile(), 'utf8')) as Record<string, unknown>
      for (const [pictor, model] of Object.entries(parsed)) {
        if (typeof model === 'string' && model.length > 0) this.#models.set(pictor, model)
      }
    } catch {
      // No choice recorded yet: Pi runs its own default.
    }
  }

  #persistModels(): void {
    try {
      mkdirSync(this.#options.userData, { recursive: true })
      writeFileSync(
        this.#modelsFile(),
        `${JSON.stringify(Object.fromEntries(this.#models), null, 2)}\n`,
        'utf8',
      )
    } catch {
      // A read-only profile only costs the choice, never the turn.
    }
  }

  #sessionDirectory(): string {
    const directory = join(this.#options.userData, 'pi-sessions')
    mkdirSync(directory, { recursive: true })
    return directory
  }

  /** Pi names a session file `<timestamp>_<id>.jsonl`. */
  #sessionFile(kernelSession: string): string | null {
    const directory = this.#sessionDirectory()
    try {
      const match = readdirSync(directory).find((name) => name.endsWith(`_${kernelSession}.jsonl`))
      return match === undefined ? null : join(directory, match)
    } catch {
      return null
    }
  }

  #sessionsFile(): string {
    return join(this.#options.userData, 'pi-sessions.json')
  }

  #loadSessions(): void {
    if (this.#sessionsLoaded) return
    this.#sessionsLoaded = true
    try {
      const parsed = JSON.parse(readFileSync(this.#sessionsFile(), 'utf8')) as Record<
        string,
        unknown
      >
      for (const [pictor, kernel] of Object.entries(parsed)) {
        if (typeof kernel === 'string' && kernel.length > 0) this.#sessions.set(pictor, kernel)
      }
    } catch {
      // No mapping yet: the first turn creates each session.
    }
  }

  #persistSessions(): void {
    try {
      mkdirSync(this.#options.userData, { recursive: true })
      writeFileSync(
        this.#sessionsFile(),
        `${JSON.stringify(Object.fromEntries(this.#sessions), null, 2)}\n`,
        'utf8',
      )
    } catch {
      // A read-only profile only costs a resumed conversation, never the turn.
    }
  }
}

/** How one model is named across messages and the picker: `provider/id`. */
function modelKey(provider: string | null, id: string): string {
  return provider === null || id.includes('/') ? id : `${provider}/${id}`
}

/** Pi's version, read from the package the script belongs to. */
function packageVersion(script: string): string | null {
  let current = dirname(script)
  for (let depth = 0; depth < 4; depth += 1) {
    const manifest = join(current, 'package.json')
    if (existsSync(manifest)) {
      try {
        const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { version?: unknown }
        if (typeof parsed.version === 'string') return parsed.version
      } catch {
        return null
      }
    }
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
  return null
}

/** Why a command was refused, if Pi said so. */
function problemOf(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null
  const response = value as { success?: unknown; error?: unknown }
  if (response.success !== false) return null
  const error = response.error
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return 'pi 拒绝了这个命令'
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function tail(stderr: string): string {
  const text = stderr.trim().split('\n').slice(-2).join(' ')
  return text.length === 0 ? '' : `：${text}`
}
