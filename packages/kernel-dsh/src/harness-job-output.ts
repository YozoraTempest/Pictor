import type { KernelJobOutput } from '@pictor/kernel-sdk'

/**
 * Reading a job's output stream into something a window can show.
 *
 * `job/follow` sends three kinds of frame: an `opened` anchor carrying the job and the
 * offset the output continues from, a run of `output` batches, and — for a job that has
 * settled — a terminal `status`. A job still running never sends that last frame, so
 * "partial" is not an error state: it is the ordinary shape of reading live output.
 *
 * The chunks carry the stream they came from. Merging them into one blob would lose the
 * one distinction a reader needs when something failed, so segments keep it.
 */

/** Whether the read stopped before the runtime said the job had settled. */
export function jobOutputOf(frames: readonly unknown[]): KernelJobOutput {
  const segments: { channel: string | null; text: string }[] = []
  let partial = true
  let lossy = false

  const append = (channel: string | null, text: string): void => {
    if (text.length === 0) return
    const last = segments.at(-1)
    if (last !== undefined && last.channel === channel) last.text += text
    else segments.push({ channel, text })
  }

  for (const raw of frames) {
    if (typeof raw !== 'object' || raw === null) continue
    const frame = raw as {
      type?: unknown
      from?: unknown
      lossy?: unknown
      chunks?: unknown
    }

    if (frame.type === 'opened') {
      // A non-zero offset means the oldest retained byte is not the first one the job
      // wrote: the runtime already had to drop something.
      if (typeof frame.from === 'number' && frame.from > 0) lossy = true
      continue
    }

    if (frame.type === 'status') {
      // Terminal projection: the job settled and its ring was drained.
      partial = false
      continue
    }

    if (frame.type !== 'output') continue
    if (frame.lossy === true) lossy = true
    if (!Array.isArray(frame.chunks)) continue

    for (const chunk of frame.chunks) {
      if (typeof chunk !== 'object' || chunk === null) continue
      const record = chunk as { text?: unknown; channel?: unknown; gapBefore?: unknown }
      if (record.gapBefore === true) lossy = true
      if (typeof record.text !== 'string') continue
      append(typeof record.channel === 'string' ? record.channel : null, record.text)
    }
  }

  return {
    segments,
    text: segments.map((segment) => segment.text).join(''),
    partial,
    lossy,
  }
}
