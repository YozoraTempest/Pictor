export interface CommandApprovalRequest {
  callId: string
  command: string
  cwd: string
  purpose: string
}

interface PendingApproval {
  resolve: (allowed: boolean) => void
  removeAbortListener: () => void
}

export class ApprovalBroker {
  private readonly pending = new Map<string, PendingApproval>()

  constructor(private readonly onRequest: (request: CommandApprovalRequest) => void) {}

  request(request: CommandApprovalRequest, signal?: AbortSignal): Promise<boolean> {
    if (this.pending.has(request.callId)) throw new Error('Duplicate command approval call ID')
    if (signal?.aborted) return Promise.reject(signal.reason)

    return new Promise<boolean>((resolve, reject) => {
      const abort = () => {
        this.pending.delete(request.callId)
        reject(signal?.reason ?? new Error('Command approval aborted'))
      }
      signal?.addEventListener('abort', abort, { once: true })
      this.pending.set(request.callId, {
        resolve,
        removeAbortListener: () => signal?.removeEventListener('abort', abort),
      })
      this.onRequest(request)
    })
  }

  resolve(callId: string, allowed: boolean): boolean {
    const approval = this.pending.get(callId)
    if (!approval) return false
    this.pending.delete(callId)
    approval.removeAbortListener()
    approval.resolve(allowed)
    return true
  }

  cancelAll(reason = new Error('Runtime cancelled')): void {
    for (const [callId, approval] of this.pending) {
      this.pending.delete(callId)
      approval.removeAbortListener()
      approval.resolve(false)
    }
    void reason
  }

  hasPending(callId: string): boolean {
    return this.pending.has(callId)
  }
}
