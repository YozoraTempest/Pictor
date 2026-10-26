import { useEffect, useState } from 'react'

import type { KernelJobOutput } from '../../../../shared/bridge.js'

import { Banner, Dialog, Spinner } from '../../components/ui/index.js'
import { cn } from '../../lib/cn.js'

/**
 * What one background job printed.
 *
 * Read when the dialog opens, not tailed: the runtime keeps the output in a ring, and a
 * live stream per row would cost a socket for something nobody watches until they ask.
 * That also means the read can be of a job that is still running — `partial` says so, and
 * the dialog says "so far" rather than implying an end that has not happened.
 *
 * Segments keep the stream each chunk came from. A failure is readable only if the reader
 * can tell which stream said it, so `stderr` is marked instead of merged into one blob.
 */
export function JobOutputDialog({
  sessionId,
  jobId,
  label,
  onClose,
}: {
  sessionId: string
  jobId: string
  label: string
  onClose: () => void
}): React.JSX.Element {
  const [output, setOutput] = useState<KernelJobOutput | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setOutput(null)
    setError(null)
    void window.pictor
      .kernelJobOutput(sessionId, jobId)
      .then((read) => {
        if (alive) setOutput(read)
      })
      .catch((reason: unknown) => {
        if (!alive) return
        setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      alive = false
    }
  }, [sessionId, jobId])

  return (
    <Dialog open title={`任务输出 · ${label}`} onClose={onClose}>
      <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto pr-1">
        {error !== null && <Banner tone="error">{error}</Banner>}

        {error === null && output === null && (
          <div className="flex items-center gap-2 px-1 py-2 text-2xs text-faint">
            <Spinner className="size-3.5" />
            读取任务的输出
          </div>
        )}

        {output !== null && (
          <>
            {output.partial && (
              <p className="px-1 text-2xs leading-relaxed text-faint">
                任务还在跑：下面是目前为止的输出。
              </p>
            )}
            {output.lossy && (
              <p className="px-1 text-2xs leading-relaxed text-faint">
                更早的输出已被运行时丢弃，这里不是全部。
              </p>
            )}
            {output.segments.length === 0 ? (
              <p className="px-1 py-2 text-2xs leading-relaxed text-faint">这个任务还没有输出。</p>
            ) : (
              <pre className="selectable overflow-x-auto rounded-md border border-border bg-surface/40 px-3 py-2 font-mono text-2xs leading-relaxed whitespace-pre-wrap">
                {output.segments.map((segment, index) => (
                  <span
                    // Segments are positional: the same text can appear in both streams.
                    key={`${String(index)}-${segment.channel ?? 'out'}`}
                    className={cn(segment.channel === 'stderr' && 'text-danger/80')}
                    title={segment.channel ?? 'stdout'}
                  >
                    {segment.text}
                  </span>
                ))}
              </pre>
            )}
          </>
        )}
      </div>
    </Dialog>
  )
}
