import { randomUUID } from 'node:crypto'

import type { ExtensionUIDialogOptions, ExtensionUIContext } from '@earendil-works/pi-coding-agent'

type ExtensionUiEvent =
  | {
      type: 'extension.ui.requested'
      requestId: string
      kind: 'select' | 'confirm' | 'input' | 'editor'
      title: string
      message: string | null
      options: string[]
      value: string | null
    }
  | {
      type: 'extension.ui.notification'
      level: 'info' | 'warning' | 'error'
      message: string
    }
  | { type: 'extension.ui.status'; key: string; text: string | null }

interface PendingRequest {
  resolve(value: string | boolean | null): void
  fallback: string | boolean | null
  cleanup(): void
}

export class ExtensionUiBroker {
  private readonly pending = new Map<string, PendingRequest>()
  private editorText = ''

  constructor(private readonly emit: (event: ExtensionUiEvent) => void) {}

  createContext(): ExtensionUIContext {
    const unavailable = (feature: string) =>
      this.emit({
        type: 'extension.ui.notification',
        level: 'warning',
        message: `${feature} is unavailable in Pictor RPC mode`,
      })

    return {
      select: async (title, options, dialog) => {
        const value = await this.request(
          { kind: 'select', title, options, message: null, value: null },
          null,
          dialog,
        )
        return typeof value === 'string' && options.includes(value) ? value : undefined
      },
      confirm: async (title, message, dialog) => {
        const value = await this.request(
          { kind: 'confirm', title, message, options: [], value: null },
          false,
          dialog,
        )
        return value === true
      },
      input: async (title, placeholder, dialog) => {
        const value = await this.request(
          { kind: 'input', title, message: null, options: [], value: placeholder ?? null },
          null,
          dialog,
        )
        return typeof value === 'string' ? value : undefined
      },
      editor: async (title, prefill) => {
        const value = await this.request(
          { kind: 'editor', title, message: null, options: [], value: prefill ?? null },
          null,
        )
        return typeof value === 'string' ? value : undefined
      },
      notify: (message, level = 'info') =>
        this.emit({ type: 'extension.ui.notification', level, message }),
      setStatus: (key, text) => this.emit({ type: 'extension.ui.status', key, text: text ?? null }),
      setWorkingMessage: (message) =>
        this.emit({ type: 'extension.ui.status', key: 'working', text: message ?? null }),
      setWorkingVisible: (visible) =>
        this.emit({ type: 'extension.ui.status', key: 'working-visible', text: String(visible) }),
      setWorkingIndicator: () => unavailable('Custom working indicators'),
      setHiddenThinkingLabel: (label) =>
        this.emit({ type: 'extension.ui.status', key: 'thinking-label', text: label ?? null }),
      setWidget: (key, content) => {
        if (content === undefined || Array.isArray(content)) {
          this.emit({
            type: 'extension.ui.status',
            key: `widget:${key}`,
            text: content?.join('\n') ?? null,
          })
        } else unavailable('TUI widget factories')
      },
      setFooter: () => unavailable('Custom TUI footers'),
      setHeader: () => unavailable('Custom TUI headers'),
      setTitle: (title) => this.emit({ type: 'extension.ui.status', key: 'title', text: title }),
      onTerminalInput: () => {
        unavailable('Raw terminal input')
        return () => undefined
      },
      custom: async () => {
        throw new Error('Custom TUI components are unavailable in Pictor RPC mode')
      },
      pasteToEditor: (text) => {
        this.editorText += text
      },
      setEditorText: (text) => {
        this.editorText = text
      },
      getEditorText: () => this.editorText,
      addAutocompleteProvider: () => unavailable('TUI autocomplete providers'),
      setEditorComponent: () => unavailable('Custom TUI editors'),
      getEditorComponent: () => undefined,
      get theme(): never {
        throw new Error('TUI themes are unavailable in Pictor RPC mode')
      },
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({
        success: false,
        error: 'TUI themes are unavailable in Pictor RPC mode',
      }),
      getToolsExpanded: () => false,
      setToolsExpanded: () => unavailable('TUI tool expansion'),
    }
  }

  respond(requestId: string, value: string | boolean | null): boolean {
    const request = this.pending.get(requestId)
    if (!request) return false
    request.cleanup()
    request.resolve(value)
    return true
  }

  cancelAll(): void {
    for (const request of this.pending.values()) {
      request.cleanup()
      request.resolve(request.fallback)
    }
    this.pending.clear()
  }

  private request(
    request: Omit<
      Extract<ExtensionUiEvent, { type: 'extension.ui.requested' }>,
      'type' | 'requestId'
    >,
    fallback: string | boolean | null,
    options?: ExtensionUIDialogOptions,
  ): Promise<string | boolean | null> {
    const requestId = randomUUID()
    return new Promise((resolve) => {
      let timeout: ReturnType<typeof setTimeout> | undefined
      const onAbort = () => finish(fallback)
      const cleanup = () => {
        if (timeout) clearTimeout(timeout)
        options?.signal?.removeEventListener('abort', onAbort)
        this.pending.delete(requestId)
      }
      const finish = (value: string | boolean | null) => {
        cleanup()
        resolve(value)
      }
      this.pending.set(requestId, { resolve, fallback, cleanup })
      options?.signal?.addEventListener('abort', onAbort, { once: true })
      if (options?.timeout) timeout = setTimeout(() => finish(fallback), options.timeout)
      this.emit({ type: 'extension.ui.requested', requestId, ...request })
    })
  }
}
