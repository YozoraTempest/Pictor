import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join } from 'node:path'

import type { HarnessNotification } from '@pictor/harness'
import type { CatalogSkill, ChatHistoryPage, ChatImage, ModelEffort } from '@pictor/shared'

import type { HarnessStatus, KernelCapabilities, PermissionMode } from '../../shared/bridge.js'
import type { AgentProbeResult, KernelDriver } from './driver.js'
import { historyRows, textOf, type StoredRecord } from './pi-history.js'

/** How long one turn may run before the child is killed. */
const TURN_TIMEOUT_MS = 30 * 60 * 1000
/** How many history rows one page opens with. */
const HISTORY_PAGE = 50

export interface PiCliDriverOptions {
  userData: string
  /** Directory a conversation runs in, resolved from its project. */
  resolveCwd: (sessionId: string) => Promise<string | null>
  /** Executable to run; defaults to `pi` on PATH. */
  binary?: string
}

/** One streaming message, as Pi reports it: content blocks plus the usage. */
interface PiMessage {
  role?: unknown
  content?: unknown
  usage?: unknown
}

/** The tail of a child's stderr, as a clause to append to a failure reason. */
function explain(stderr: string): string {
  const tail = stderr.trim().split('\n').slice(-2).join(' ')
  return tail.length === 0 ? '' : `：${tail}`
}

/**
 * Pi coding agent, driven as a one-shot CLI.
 *
 * Pi has no server: one turn is one `pi -p --mode json` process, which streams its
 * work as JSONL and exits. That shape decides what this driver can and cannot do,
 * and saying so honestly matters more than a long list of stubs — the interface
 * exists so the window never promises what a kernel cannot deliver.
 *
 * What it can do: send a message, stream the answer and its thinking, run tools,
 * report usage, resume a session, read a session back. What it cannot: hold a tool
 * call for an approval, ask the user mid-turn, set a sandbox per conversation, or
 * fork at an arbitrary message — Pi decides those itself.
 *
 * Shape taken from a real run: `session` (carries the id), `turn_start`,
 * `message_update` (`assistantMessageEvent.type` says text or thinking),
 * `tool_execution_start`/`tool_execution_end`, `turn_end` (carries the final
 * `message.usage`), `agent_end`, `agent_settled`. One process may contain several
 * Pi turns — one per model step — but Pictor sees a single turn, because the
 * process is what the user started and what Stop kills.
 */
export class PiCliDriver implements KernelDriver {
  readonly id = 'pi'
  /**
   * Pi decides these itself, so the window offers none of them: the CLI has no
   * per-conversation sandbox, cannot ask a question mid-turn, reads neither
   * Pictor's model nor its skill catalog, and cannot fork at a message boundary.
   */
  readonly capabilities: KernelCapabilities = {
    permission: false,
    model: false,
    skills: false,
    fork: false,
  }

  readonly #options: PiCliDriverOptions
  readonly #binary: string
  readonly #listeners = new Set<(notification: HarnessNotification) => void>()
  /** Live child per conversation, so a cancel has something to kill. */
  readonly #running = new Map<string, ChildProcess>()
  /** Conversations told to stop, so an exit code 143 reads as "cancelled". */
  readonly #cancelling = new Set<string>()
  /** Turn counter per conversation; the run id the window keys its stream on. */
  readonly #turns = new Map<string, number>()
  /** Pictor session id → Pi session id; persisted so a restart can resume. */
  readonly #sessions = new Map<string, string>()
  #sessionsLoaded = false
  #cwd: string | null = null

  constructor(options: PiCliDriverOptions) {
    this.#options = options
    // `PICTOR_PI_BIN` is the development counterpart of `PICTOR_DSH_BIN`: a pin
    // for one checkout, or a wrapper that can be inspected.
    this.#binary = options.binary ?? process.env['PICTOR_PI_BIN'] ?? 'pi'
  }

  // ---- lifecycle -----------------------------------------------------------

  /**
   * Nothing to boot: the CLI *is* the kernel, and every turn starts it. Starting
   * this driver only records where an unnamed conversation would run.
   */
  async start(cwd: string): Promise<HarnessStatus> {
    this.#cwd = cwd
    this.#loadSessions()
    return this.status()
  }

  async stop(): Promise<HarnessStatus> {
    for (const [sessionId, child] of this.#running) {
      this.#cancelling.add(sessionId)
      child.kill('SIGTERM')
    }
    this.#running.clear()
    return this.status()
  }

  /**
   * Whether this machine can run Pi at all.
   *
   * A CLI kernel has no state of its own in between turns, so "ready" can only
   * mean "the executable is here". The check runs per call, so installing Pi
   * while the window is open shows up on the next look.
   */
  status(): HarnessStatus {
    const binary = this.#available() ? this.#binary : null
    return {
      state: binary === null ? 'error' : 'ready',
      binary,
      // Pi reports neither a version nor a model until it runs a turn, and a
      // status call is not allowed to run one.
      version: null,
      expectedVersion: null,
      // Pi keeps its credentials in the user's own home; what Pictor owns is the
      // directory its conversations are stored in, and that is what this names.
      home: this.#sessionDirectory(),
      provider: null,
      model: null,
      serverInfo: null,
      permissionMode: 'workspace-write',
      error: binary === null ? `没有找到 pi 可执行文件（${this.#binary}），先安装再试` : null,
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

  /**
   * Starts one turn and returns as soon as the process is up.
   *
   * The answer arrives through {@link onNotification}, so the caller is not held
   * for the length of a turn; a failure to even spawn (no binary, no permission)
   * arrives the same way, as a closed turn carrying its reason.
   */
  async prompt(
    sessionId: string,
    text: string,
    images: readonly ChatImage[] = [],
    effort: ModelEffort | null = null,
  ): Promise<void> {
    if (!this.#available()) {
      throw new Error(`没有找到 pi 可执行文件（${this.#binary}），先安装再试`)
    }
    if (this.#running.has(sessionId)) throw new Error('上一轮还没有结束，等它跑完或者先停止')
    if (images.length > 0) {
      // Pi takes images as `@path` attachments, which needs a file on disk; a
      // pasted base64 image has no path. Refusing beats dropping it silently.
      throw new Error('Pi 内核还不支持从 Pictor 粘贴图片；在 pi 里图片要走 @path 附件')
    }

    const cwd = (await this.#options.resolveCwd(sessionId)) ?? this.#cwd ?? homedir()
    this.#loadSessions()

    const args = ['-p', '--mode', 'json', '--session-dir', this.#sessionDirectory()]
    const known = this.#sessions.get(sessionId)
    if (known !== undefined) args.push('--session-id', known)
    // No level picked means Pi keeps its own configured default, which is exactly
    // what "untouched" should do.
    if (effort !== null) args.push('--thinking', effort)
    args.push(text)

    const child = spawn(this.#binary, args, {
      cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.#running.set(sessionId, child)
    void this.#drain(sessionId, child)
  }

  async cancel(sessionId: string): Promise<void> {
    const child = this.#running.get(sessionId)
    if (child === undefined) return
    this.#cancelling.add(sessionId)
    child.kill('SIGTERM')
  }

  /** Pi has no message boundary to branch from: a turn is one process. */
  async fork(): Promise<string> {
    throw new Error('Pi 内核不能在会话中分叉；换内核请在输入框里新建分支')
  }

  adopt(sessionId: string, kernelSessionId: string): void {
    this.#loadSessions()
    this.#sessions.set(sessionId, kernelSessionId)
    this.#persistSessions()
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
    const messages = historyRows(this.#records(sessionId))

    // Newest last, and a page is the tail of the conversation.
    const end = Math.max(0, messages.length - Math.max(0, offset))
    const start = Math.max(0, end - Math.max(1, limit))
    return {
      messages: messages.slice(start, end),
      nextOffset: messages.length - start,
      hasMore: start > 0,
    }
  }

  /** The file's lines, or nothing when there is no file to read yet. */
  #records(sessionId: string): StoredRecord[] {
    this.#loadSessions()
    const kernelSession = this.#sessions.get(sessionId)
    if (kernelSession === undefined) return []
    const file = this.#sessionFile(kernelSession)
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

  // ---- what the CLI cannot express -----------------------------------------

  /** Pi runs with whatever sandbox its own settings chose; it reports none. */
  async sessionPermission(): Promise<string | null> {
    return null
  }

  async setSessionPermission(): Promise<void> {
    throw new Error('Pi 内核不支持按会话切换沙箱；请在 pi 自己的设置里调整')
  }

  setPermissionMode(_mode: PermissionMode): void {
    // Recorded by the caller for the next conversation; Pi reads none of it.
  }

  async applyPermission(): Promise<void> {
    // Nothing to apply: the CLI has no live setting channel.
  }

  async applySettings(): Promise<void> {
    // Nothing to re-apply: a turn starts a fresh process.
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

  /** Pi loads skills from disk but exposes no catalog to ask; it lists none. */
  async listSkills(): Promise<CatalogSkill[]> {
    return []
  }

  async answerApproval(): Promise<void> {
    throw new Error('Pi 内核没有需要审批的工具调用')
  }

  async answerQuestions(): Promise<void> {
    throw new Error('Pi 内核不能在对话中途提问')
  }

  /** One throwaway turn, for the diagnosis button. */
  async probe(prompt: string, cwd: string): Promise<AgentProbeResult> {
    if (!this.#available()) {
      return {
        ok: false,
        text: '',
        events: [],
        message: `没有找到 pi 可执行文件（${this.#binary}）`,
      }
    }

    const result = await new Promise<{ text: string; error: string | null }>((resolve) => {
      const child = spawn(this.#binary, ['-p', '--mode', 'json', prompt], {
        cwd,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let out = ''
      let err = ''
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        out += chunk
      })
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => {
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
              const message = record['message'] as PiMessage | null
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

  // ---- one turn, as the window sees it --------------------------------------

  /**
   * Pumps one child process into notifications.
   *
   * A turn opens as soon as the process exists, so a spawn failure still closes a
   * run instead of leaving the window waiting on one that never started. Pi's own
   * turns — one per model step — do not open Pictor turns: the process is the
   * unit the user started, and re-keying the stream mid-run would restart the
   * answer bubble in the middle of an answer.
   */
  async #drain(sessionId: string, child: ChildProcess): Promise<void> {
    const turn = (this.#turns.get(sessionId) ?? 0) + 1
    this.#turns.set(sessionId, turn)

    const durable = (type: string, data: unknown): void => {
      this.#emit({
        method: 'session.follow',
        params: { sessionId, frame: { type: 'event', event: { type, time: Date.now(), data } } },
      })
    }
    const chunk = (value: unknown): void => {
      this.#emit({
        method: 'session.follow',
        params: {
          sessionId,
          frame: { type: 'assistant-stream', frame: { type: 'chunk', chunk: value } },
        },
      })
    }

    durable('turn/start', { turn })

    let buffer = ''
    let stderr = ''
    let failure: string | null = null
    let answer = ''
    /** Whether the turn produced anything at all: text, thinking, or a tool. */
    let produced = false
    const collect = (): void => {
      for (;;) {
        const newline = buffer.indexOf('\n')
        if (newline === -1) return
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (line.length === 0) continue

        let record: Record<string, unknown>
        try {
          record = JSON.parse(line) as Record<string, unknown>
        } catch {
          // Pi's stdout is JSONL; a line that is not JSON is a warning or a
          // progress note, not part of the conversation.
          continue
        }

        const type = typeof record['type'] === 'string' ? record['type'] : ''
        switch (type) {
          case 'session': {
            const id = typeof record['id'] === 'string' ? record['id'] : null
            if (id !== null && this.#sessions.get(sessionId) !== id) {
              this.#sessions.set(sessionId, id)
              this.#persistSessions()
            }
            break
          }
          case 'message_update': {
            const inner = (record['assistantMessageEvent'] ?? {}) as Record<string, unknown>
            const kind = typeof inner['type'] === 'string' ? inner['type'] : ''
            const delta = typeof inner['delta'] === 'string' ? inner['delta'] : ''
            if (delta.length === 0) break
            if (kind !== 'text_delta' && kind !== 'thinking_delta') break
            produced = true
            chunk({
              type: kind === 'text_delta' ? 'text-delta' : 'reasoning-delta',
              text: delta,
            })
            break
          }
          case 'tool_execution_start': {
            produced = true
            durable('tool/call', {
              name: typeof record['toolName'] === 'string' ? record['toolName'] : 'tool',
              callId: typeof record['toolCallId'] === 'string' ? record['toolCallId'] : '',
              arguments: JSON.stringify(record['args'] ?? {}),
            })
            break
          }
          case 'tool_execution_end': {
            const result = (record['result'] ?? {}) as { content?: unknown }
            durable('tool/result', {
              message: {
                toolCallId: record['toolCallId'],
                isError: record['isError'] === true,
                content: [{ type: 'text', text: textOf(result.content) }],
              },
            })
            break
          }
          case 'turn_end': {
            const message = (record['message'] ?? {}) as PiMessage
            // The final text of the step, as a fallback for a run whose deltas
            // were lost: the window drops it when it already streamed the answer.
            answer = textOf(message.content)
            if (answer.length > 0) produced = true
            const usage = (message.usage ?? {}) as Record<string, unknown>
            const count = (key: string): number | null => {
              const value = usage[key]
              return typeof value === 'number' && Number.isFinite(value) ? value : null
            }
            const input = count('input')
            const output = count('output')
            const total = count('totalTokens')
            if (input !== null || output !== null || total !== null) {
              chunk({
                type: 'usage',
                usage: { inputTokens: input, outputTokens: output, totalTokens: total },
              })
            }
            break
          }
          case 'agent_end': {
            if (record['willRetry'] === true) failure = 'pi 正在重试这一轮'
            break
          }
          default:
            break
        }
      }
    }

    const timer = setTimeout(() => {
      failure = `一轮超过 ${String(TURN_TIMEOUT_MS / 60_000)} 分钟，已停止`
      this.#cancelling.add(sessionId)
      child.kill('SIGTERM')
    }, TURN_TIMEOUT_MS)

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (data: string) => {
      buffer += data
      collect()
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (data: string) => {
      // Enough to explain an exit without holding a whole log in memory.
      stderr = `${stderr}${data}`.slice(-2_000)
    })

    const code = await new Promise<number | null>((resolve) => {
      child.on('error', (error) => {
        failure = error.message
        resolve(null)
      })
      child.on('exit', (exitCode) => resolve(exitCode))
    })

    clearTimeout(timer)
    // Anything the last chunk left without a newline still belongs to the turn.
    collect()
    this.#running.delete(sessionId)
    const cancelled = this.#cancelling.delete(sessionId)
    if (failure === null && !cancelled && code !== 0) {
      failure = `pi 退出码 ${String(code)}${explain(stderr)}`
    }
    // An exit code of 0 that produced nothing is still a failure: a turn that
    // simply closes would leave an empty answer with no reason why. Pi writes
    // nothing to stdout when its model step produced no content at all, so the
    // reason, if any, is on stderr.
    if (failure === null && !cancelled && !produced) {
      failure = `pi 没有返回任何内容，退出码 0${explain(stderr)}`
    }

    // A run that streamed nothing would otherwise close with an empty bubble;
    // when deltas did arrive the window already holds the text and drops this.
    if (failure === null && !cancelled && answer.length > 0) {
      durable('assistant/message', {
        message: { role: 'assistant', content: [{ type: 'text', text: answer }] },
      })
    }

    durable('turn/end', {
      reason: cancelled
        ? { kind: 'aborted' }
        : failure === null
          ? { kind: 'completed' }
          : { kind: 'error', error: { message: failure } },
    })
  }

  // ---- plumbing ------------------------------------------------------------

  #emit(notification: HarnessNotification): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(notification)
      } catch {
        // A broken listener must not break the turn for the others.
      }
    }
  }

  /** Whether the executable resolves; checked per call so an install shows up. */
  #available(): boolean {
    // A configured binary names a path, not a name to look up on PATH.
    if (isAbsolute(this.#binary)) return existsSync(this.#binary)
    const path = process.env['PATH'] ?? ''
    return path
      .split(delimiter)
      .some((directory) => directory.length > 0 && existsSync(join(directory, this.#binary)))
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
