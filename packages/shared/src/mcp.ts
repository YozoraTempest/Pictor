/**
 * MCP servers, as Pictor stores them.
 *
 * One list, two kernels: the shape here is the union of what both can express, and each
 * kernel translates it into its own configuration (dsh's profile patch, Pi's
 * `mcp.json`). Keeping the list in Pictor's settings is what lets one page manage what
 * an agent can reach without either kernel owning the truth.
 */
export type McpTransport = 'stdio' | 'http'

export interface McpServerSpec {
  /** Pictor's own row key; also the name tools are exposed under. */
  name: string
  transport: McpTransport
  /** stdio: the executable. Empty for http. */
  command: string
  /** stdio: its arguments. */
  args: string[]
  /** Extra environment for a stdio server (tokens usually live here). */
  env: Record<string, string>
  /** http: the endpoint. Empty for stdio. */
  url: string
  /** http: extra headers, e.g. `Authorization`. */
  headers: Record<string, string>
  /** A server that is listed but not connected. */
  enabled: boolean
}

/** The name both kernels accept: letters, digits, `_` and `-`. */
const NAME = /^[A-Za-z0-9_-]{1,32}$/

/** Whether a name can be used as a server name, in either kernel. */
export function isMcpServerName(name: string): boolean {
  return NAME.test(name)
}

function strings(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) return {}
  const out: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && entry.length > 0) out[key] = entry
  }
  return out
}

/**
 * Reads the stored list, dropping what cannot be used.
 *
 * A malformed row is dropped rather than failing the page: one bad entry must not take
 * the whole capability away from a person who only mistyped a command.
 */
export function parseMcpServers(value: unknown): McpServerSpec[] {
  if (!Array.isArray(value)) return []

  const servers: McpServerSpec[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const name = typeof record['name'] === 'string' ? record['name'].trim() : ''
    if (!isMcpServerName(name) || seen.has(name)) continue
    const transport = record['transport'] === 'http' ? 'http' : 'stdio'
    const command = typeof record['command'] === 'string' ? record['command'].trim() : ''
    const url = typeof record['url'] === 'string' ? record['url'].trim() : ''
    // A server with neither an executable nor a URL would be a row that can never
    // connect; it is dropped instead of being drawn as broken.
    if (transport === 'stdio' && command.length === 0) continue
    if (transport === 'http' && url.length === 0) continue

    seen.add(name)
    servers.push({
      name,
      transport,
      command: transport === 'stdio' ? command : '',
      args: Array.isArray(record['args'])
        ? record['args'].filter((arg): arg is string => typeof arg === 'string')
        : [],
      env: strings(record['env']),
      url: transport === 'http' ? url : '',
      headers: strings(record['headers']),
      enabled: record['enabled'] !== false,
    })
  }
  return servers
}

/** The servers a kernel should actually load. */
export function enabledMcpServers(servers: readonly McpServerSpec[]): McpServerSpec[] {
  return servers.filter((server) => server.enabled)
}
