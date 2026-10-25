/**
 * Shared plumbing for kernels driven as a one-shot CLI that prints JSONL.
 *
 * Both Codex and Pi can be told to run a single prompt and narrate it line by
 * line. That is the cheapest adapter shape: no protocol to reimplement, no port
 * to allocate, and a crash is just a non-zero exit. The differences between them
 * are which flags start it and what the lines are called, which each adapter
 * supplies.
 */

/** @typedef {import('./types.mjs').KernelEvent} KernelEvent */

/**
 * Runs one CLI turn and feeds every JSON line to `handle`.
 *
 * Lines that are not JSON are reported as notices rather than dropped: a CLI that
 * changed its output format must be visible, not silently empty.
 *
 * @param {object} options
 * @param {string} options.command
 * @param {string[]} options.args
 * @param {string} options.cwd
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {AbortSignal} options.signal
 * @param {(line: Record<string, unknown>) => void} options.handle
 * @param {(event: KernelEvent) => void} options.onEvent
 * @returns {Promise<{ code: number | null, stderr: string }>}
 */
export async function runJsonLines({ command, args, cwd, env, signal, handle, onEvent }) {
  const { spawn } = await import('node:child_process')

  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let buffer = ''
    let stderr = ''
    let settled = false

    const finish = (code, error) => {
      if (settled) return
      settled = true
      if (error !== undefined) reject(error)
      else resolve({ code, stderr })
    }

    const onAbort = () => {
      child.kill('SIGTERM')
    }
    signal.addEventListener('abort', onAbort, { once: true })

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      for (;;) {
        const newline = buffer.indexOf('\n')
        if (newline === -1) break
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (line.length === 0) continue
        let parsed
        try {
          parsed = JSON.parse(line)
        } catch {
          onEvent({ type: 'notice', message: `非 JSON 输出：${line.slice(0, 160)}` })
          continue
        }
        if (typeof parsed !== 'object' || parsed === null) continue
        handle(parsed)
      }
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      // Kept for the failure report only: these CLIs are chatty on stderr even
      // when the turn goes well.
      stderr = `${stderr}${chunk}`.slice(-4_000)
    })

    child.on('error', (error) => {
      signal.removeEventListener('abort', onAbort)
      finish(null, error)
    })
    child.on('exit', (code) => {
      signal.removeEventListener('abort', onAbort)
      if (buffer.trim().length > 0) {
        onEvent({ type: 'notice', message: `结尾残留输出：${buffer.trim().slice(0, 160)}` })
      }
      finish(code)
    })
  })
}

/**
 * Reads a JSONL kernel's `usage` object without assuming one vendor's field names.
 *
 * The three counts are named differently by every provider, and a wrong guess
 * would misreport spend; a missing number stays `null` instead.
 *
 * @param {unknown} usage
 * @returns {{ input: number | null, output: number | null, total: number | null }}
 */
export function readUsage(usage) {
  const record = typeof usage === 'object' && usage !== null ? usage : {}
  const pick = (...keys) => {
    for (const key of keys) {
      const value = record[key]
      if (typeof value === 'number' && Number.isFinite(value)) return value
    }
    return null
  }
  const input = pick('input_tokens', 'input', 'prompt_tokens', 'promptTokens')
  const output = pick('output_tokens', 'output', 'completion_tokens', 'completionTokens')
  const total = pick('total_tokens', 'total', 'totalTokens')
  return {
    input,
    output,
    total: total ?? (input !== null && output !== null ? input + output : null),
  }
}
