import { randomUUID } from 'node:crypto'
import { open, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, parse, resolve } from 'node:path'

import type { WebDirectoryListing } from '../shared/web-files.js'

const MAX_UPLOAD_BYTES = 128 * 1024 * 1024
const MAX_DIRECTORY_ENTRIES = 5_000
const TRANSFER_TTL_MS = 30 * 60 * 1_000

interface TransferRecord {
  readonly kind: 'import' | 'export'
  readonly path: string
  readonly name: string
  readonly createdAt: number
}

export interface DownloadTransfer {
  readonly path: string
  readonly name: string
}

export class WebFileTransferStore {
  private readonly root: string
  private readonly transfers = new Map<string, TransferRecord>()
  private initialized = false

  constructor(
    baseDirectory: string,
    private readonly now: () => number = Date.now,
  ) {
    this.root = join(resolve(baseDirectory), randomUUID())
  }

  async listDirectory(requestedPath: string | null): Promise<WebDirectoryListing> {
    const path =
      requestedPath === null ? resolve(homedir()) : requireAbsoluteDirectoryPath(requestedPath)
    const pathStat = await stat(path)
    if (!pathStat.isDirectory()) throw new Error('所选路径不是目录')
    const entries = (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() || entry.isFile())
      .slice(0, MAX_DIRECTORY_ENTRIES)
      .map((entry) => ({
        name: entry.name,
        path: join(path, entry.name),
        kind: entry.isDirectory() ? ('directory' as const) : ('file' as const),
      }))
      .toSorted((left, right) => {
        if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1
        return left.name.localeCompare(right.name)
      })
    const root = parse(path).root
    return {
      path,
      parentPath: path === root ? null : dirname(path),
      entries,
    }
  }

  async createDirectory(parentPath: string, name: string): Promise<WebDirectoryListing> {
    const parent = requireAbsoluteDirectoryPath(parentPath)
    if (name === '.' || name === '..' || basename(name) !== name) {
      throw new Error('目录名称无效')
    }
    const path = join(parent, name)
    await mkdir(path, { mode: 0o700 })
    return this.listDirectory(path)
  }

  async createImport(
    fileName: string,
    source: AsyncIterable<Uint8Array | string>,
  ): Promise<{ ticket: string; path: string; name: string }> {
    await this.initialize()
    await this.pruneExpired()
    const name = safeFileName(fileName, '.jsonl')
    const ticket = randomUUID()
    const path = join(this.root, `${ticket}.jsonl`)
    const handle = await open(path, 'wx', 0o600)
    let size = 0
    try {
      for await (const chunk of source) {
        const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk)
        size += buffer.length
        if (size > MAX_UPLOAD_BYTES) throw new Error('Session JSONL 超过 128 MiB 上限')
        let offset = 0
        while (offset < buffer.length) {
          const result = await handle.write(buffer, offset, buffer.length - offset, null)
          offset += result.bytesWritten
        }
      }
      await handle.sync()
    } catch (error) {
      await handle.close().catch(() => undefined)
      await rm(path, { force: true }).catch(() => undefined)
      throw error
    }
    await handle.close()
    this.transfers.set(ticket, { kind: 'import', path, name, createdAt: this.now() })
    return { ticket, path, name }
  }

  async reserveExport(
    format: 'jsonl' | 'html',
    defaultFileName: string,
  ): Promise<{ ticket: string; path: string; name: string }> {
    await this.initialize()
    await this.pruneExpired()
    const extension = format === 'jsonl' ? '.jsonl' : '.html'
    const name = safeFileName(defaultFileName, extension)
    const ticket = randomUUID()
    const path = join(this.root, `${ticket}${extension}`)
    const handle = await open(path, 'wx', 0o600)
    await handle.close()
    this.transfers.set(ticket, { kind: 'export', path, name, createdAt: this.now() })
    return { ticket, path, name }
  }

  async claimDownload(ticket: string): Promise<DownloadTransfer | null> {
    await this.pruneExpired()
    const transfer = this.transfers.get(ticket)
    if (!transfer || transfer.kind !== 'export') return null
    this.transfers.delete(ticket)
    const fileStat = await stat(transfer.path).catch(() => null)
    if (fileStat?.isFile()) return { path: transfer.path, name: transfer.name }
    await rm(transfer.path, { force: true })
    return null
  }

  async completeDownload(download: DownloadTransfer): Promise<void> {
    await rm(download.path, { force: true })
  }

  async release(ticket: string): Promise<void> {
    const transfer = this.transfers.get(ticket)
    if (!transfer) return
    this.transfers.delete(ticket)
    await rm(transfer.path, { force: true })
  }

  async dispose(): Promise<void> {
    this.transfers.clear()
    if (this.initialized) await rm(this.root, { recursive: true, force: true })
    this.initialized = false
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    this.initialized = true
  }

  private async pruneExpired(): Promise<void> {
    const expired = [...this.transfers.entries()].filter(
      ([, transfer]) => this.now() - transfer.createdAt >= TRANSFER_TTL_MS,
    )
    await Promise.all(expired.map(([ticket]) => this.release(ticket)))
  }
}

function safeFileName(input: string, requiredExtension: '.jsonl' | '.html'): string {
  const printable = [...basename(input)]
    .map((character) => (character.charCodeAt(0) < 32 ? '_' : character))
    .join('')
  const candidate = printable.replace(/[<>:"/\\|?*]/g, '_').trim()
  if (!candidate) throw new Error('文件名不能为空')
  const existingExtension = extname(candidate)
  return existingExtension.toLowerCase() === requiredExtension
    ? candidate
    : `${existingExtension ? candidate.slice(0, -existingExtension.length) : candidate}${requiredExtension}`
}

export function requireAbsoluteDirectoryPath(path: string): string {
  if (!isAbsolute(path)) throw new Error('目录路径必须是绝对路径')
  return resolve(path)
}
