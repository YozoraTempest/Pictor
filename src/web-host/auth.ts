import { randomBytes, timingSafeEqual } from 'node:crypto'

const SESSION_COOKIE = 'pictor_session'

export interface WebSessionAuthOptions {
  readonly createToken?: () => string
  readonly launchToken?: string
  readonly sessionToken?: string
}

export class WebSessionAuth {
  readonly launchToken: string
  private readonly sessionToken: string
  private launchTokenAvailable = true

  constructor(options: WebSessionAuthOptions = {}) {
    const createToken = options.createToken ?? (() => randomBytes(32).toString('base64url'))
    this.launchToken = options.launchToken ?? createToken()
    this.sessionToken = options.sessionToken ?? createToken()
  }

  consumeLaunchToken(candidate: string | null): boolean {
    if (!this.launchTokenAvailable || candidate === null) return false
    if (!tokensEqual(candidate, this.launchToken)) return false
    this.launchTokenAvailable = false
    return true
  }

  authenticate(cookieHeader: string | undefined): boolean {
    const candidate = parseCookies(cookieHeader)[SESSION_COOKIE]
    return candidate !== undefined && tokensEqual(candidate, this.sessionToken)
  }

  sessionCookie(): string {
    return `${SESSION_COOKIE}=${this.sessionToken}; Path=/; HttpOnly; SameSite=Strict`
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {}
  const result: Record<string, string> = {}
  for (const item of header.split(';')) {
    const separator = item.indexOf('=')
    if (separator <= 0) continue
    const name = item.slice(0, separator).trim()
    const value = item.slice(separator + 1).trim()
    if (name) result[name] = value
  }
  return result
}

function tokensEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}
