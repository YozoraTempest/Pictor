import { useEffect, useRef, useState } from 'react'

import { Spinner } from '@vulonlok/ui'
import { cn } from '@vulonlok/ui/cn'

import { frameAnswer, frameInit, readFrameMessage, type FrameContext } from './frame-protocol.js'

/**
 * A plugin's own front end, in a box.
 *
 * The bundle inside is the plugin's: it draws whatever it wants, with its own event
 * handlers and its own state. What it does not have is a way out. The frame is
 * `sandbox="allow-scripts"` — no same-origin, so it cannot see this document, its storage
 * or its variables — and its files are served with a CSP that refuses the network. The only
 * way across is the message channel below: a request travels to the plugin in the main
 * process, and the answer comes back.
 *
 * Which is why this component is small. It owns no plugin logic; it verifies that a message
 * really came from *this* frame, hands it over, and puts the answer back. Everything a
 * person sees inside the box was drawn by plugin code that cannot reach the app.
 */
export function FrameView({
  url,
  title,
  view,
  sessionId,
  className,
  onError,
}: {
  /** The loopback address of this frame, minted per view and conversation. */
  url: string
  title: string
  /** The `views` id, so the plugin knows which of its front ends asked. */
  view: string
  sessionId: string | null
  className?: string
  /** Told when the frame never comes up, so the host can show it in its own words. */
  onError?: (message: string) => void
}): React.JSX.Element {
  const frame = useRef<HTMLIFrameElement | null>(null)
  const [loading, setLoading] = useState(true)
  /**
   * Held in a ref so a host passing an inline callback does not re-run the effect: that
   * would drop the `ready` the frame already sent, and the frame would sit there until the
   * watchdog gave up on it.
   */
  const failed = useRef(onError)
  failed.current = onError

  useEffect(() => {
    const element = frame.current
    if (element === null) return

    let alive = true
    let ready = false
    /** A bundle that throws before it reports in leaves a blank box; say so instead. */
    const timer = setTimeout(() => {
      if (alive && !ready) {
        failed.current?.('插件前端 5 秒内没有回应：检查它的入口模块是否加载成功')
        setLoading(false)
      }
    }, 5_000)

    const post = (message: unknown): void => {
      element.contentWindow?.postMessage(message, '*')
    }

    const onMessage = (event: MessageEvent): void => {
      // The frame's origin is opaque (`sandbox` without `allow-same-origin`), so `origin`
      // is the string "null" for every frame alike. The window really is the check.
      if (element.contentWindow === null || event.source !== element.contentWindow) return
      const message = readFrameMessage(event.data)
      if (message === null) return

      if (message.type === 'ready') {
        ready = true
        clearTimeout(timer)
        setLoading(false)
        post(frameInit(contextOf(sessionId)))
        return
      }

      void window.pictor
        .requestPluginFrame(view, message.action, message.value, sessionId)
        .then((answer) => {
          if (!alive) return
          post(frameAnswer(message.id, answer))
        })
        .catch((reason: unknown) => {
          if (!alive) return
          // The bridge itself failed, which is this app's problem, not the plugin's.
          post(
            frameAnswer(message.id, {
              ok: false,
              error: reason instanceof Error ? reason.message : String(reason),
            }),
          )
        })
    }

    window.addEventListener('message', onMessage)
    return () => {
      alive = false
      clearTimeout(timer)
      window.removeEventListener('message', onMessage)
    }
  }, [url, view, sessionId])

  return (
    <div className={cn('relative min-h-0', className)}>
      {loading && (
        <div className="absolute inset-0 flex items-center gap-2 p-3 text-2xs text-faint">
          <Spinner className="size-3.5" />
          加载插件前端
        </div>
      )}
      <iframe
        ref={frame}
        src={url}
        title={title}
        // No `allow-same-origin`: with it the frame would share this document's origin and
        // could reach the app. Scripts are all it needs to draw.
        sandbox="allow-scripts"
        className="size-full border-0 bg-transparent"
      />
    </div>
  )
}

/** The colours and the conversation the frame starts with. */
function contextOf(sessionId: string | null): FrameContext {
  const styles = getComputedStyle(document.documentElement)
  const read = (name: string): string => styles.getPropertyValue(name).trim()
  return {
    sessionId,
    theme: {
      bg: read('--color-bg'),
      surface: read('--color-surface'),
      border: read('--color-border'),
      text: read('--color-text'),
      muted: read('--color-muted'),
      accent: read('--color-accent'),
    },
  }
}
