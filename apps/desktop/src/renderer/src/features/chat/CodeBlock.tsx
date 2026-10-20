import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'

import { cn } from '../../lib/cn.js'
import { highlight } from './highlight.js'

export interface CodeBlockProps {
  code: string
  language: string | null
  className?: string
}

export function CodeBlock({ code, language, className }: CodeBlockProps): React.JSX.Element {
  const [html, setHtml] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    setHtml(null)

    void highlight(code, language).then((result) => {
      if (!cancelled) setHtml(result)
    })

    return () => {
      cancelled = true
    }
  }, [code, language])

  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  return (
    <div className={cn('my-3 overflow-hidden rounded-lg border border-border bg-bg', className)}>
      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface/60 px-3 py-1.5">
        <span className="font-mono text-2xs uppercase tracking-wider text-faint">
          {language ?? 'text'}
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-2xs text-faint transition-colors duration-150 hover:bg-surface-hover hover:text-text focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>

      {html === null ? (
        <pre className="max-h-96 overflow-auto px-3.5 py-3 font-mono text-xs leading-relaxed">
          <code>{code}</code>
        </pre>
      ) : (
        <div className="max-h-96 overflow-auto" dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </div>
  )
}
