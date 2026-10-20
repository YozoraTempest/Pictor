export type Unsubscribe = () => void

/**
 * Minimal typed event bus. Listeners are isolated: one throwing listener must
 * not stop the others or break the emitter.
 */
export class EventBus<TEvents extends object> {
  readonly #listeners = new Map<keyof TEvents, Set<(payload: never) => void>>()

  on<TKey extends keyof TEvents>(
    event: TKey,
    listener: (payload: TEvents[TKey]) => void,
  ): Unsubscribe {
    const listeners = this.#listeners.get(event) ?? new Set()
    listeners.add(listener as (payload: never) => void)
    this.#listeners.set(event, listeners)

    return () => {
      listeners.delete(listener as (payload: never) => void)
    }
  }

  emit<TKey extends keyof TEvents>(event: TKey, payload: TEvents[TKey]): void {
    const listeners = this.#listeners.get(event)
    if (listeners === undefined) return

    for (const listener of [...listeners]) {
      try {
        ;(listener as (value: TEvents[TKey]) => void)(payload)
      } catch {
        // Listener failures must not cascade into the emitter.
      }
    }
  }

  clear(): void {
    this.#listeners.clear()
  }
}
