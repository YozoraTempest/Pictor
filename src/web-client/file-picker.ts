import { imageAttachmentSchema, type ImageAttachment } from '../shared/domain.js'
import {
  guiPluginPickerResultSchema,
  sessionExportPickerRequestSchema,
  workspaceFilePathResultSchema,
  workspaceImagePickerResultSchema,
  type PictorBridge,
  type GuiPluginSelection,
  type GuiPluginSource,
} from '../shared/desktop-bridge.js'
import type { IpcResult } from '../shared/errors.js'
import { WEB_API_PREFIX } from '../shared/web-protocol.js'
import {
  webDirectoryListingResultSchema,
  webExportTicketResultSchema,
  webImportUploadResultSchema,
  type WebDirectoryListing,
} from '../shared/web-files.js'
import type { ModuleInvocationOutcome } from './transport.js'

type PathPickerKind = 'directory' | 'pi-extension'

export class WebFilePicker {
  private readonly importTickets = new Map<string, string>()
  private readonly exportTickets = new Map<string, string>()

  async pickPlugin(source: GuiPluginSource): Promise<IpcResult<GuiPluginSelection>> {
    try {
      const path = await this.pickLocalPath({
        title: pluginTitle(source),
        kind: source === 'pi-extension' ? 'pi-extension' : 'directory',
        allowCreateDirectory: source !== 'pi-extension',
      })
      return guiPluginPickerResultSchema.parse({ ok: true, value: { source, path } })
    } catch (error) {
      return failure(error)
    }
  }

  async pickProjectDirectory(): Promise<IpcResult<string | null>> {
    try {
      const path = await this.pickLocalPath({
        title: '选择 Pictor 项目目录',
        kind: 'directory',
        allowCreateDirectory: true,
      })
      return workspaceFilePathResultSchema.parse({ ok: true, value: path })
    } catch (error) {
      return failure(error)
    }
  }

  async pickSessionImport(): Promise<IpcResult<string | null>> {
    try {
      const files = await pickBrowserFiles('.jsonl', false)
      const file = files[0]
      if (!file) return { ok: true, value: null }
      const response = await fetch(
        `${WEB_API_PREFIX}/files/import-session?name=${encodeURIComponent(file.name)}`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: file,
        },
      )
      const result = webImportUploadResultSchema.parse(await responseJson(response))
      if (!result.ok) return result
      this.importTickets.set(result.value.path, result.value.ticket)
      return workspaceFilePathResultSchema.parse({ ok: true, value: result.value.path })
    } catch (error) {
      return failure(error)
    }
  }

  async pickSessionExport(
    input: Parameters<PictorBridge['pickSessionExport']>[0],
  ): Promise<IpcResult<string | null>> {
    try {
      const request = sessionExportPickerRequestSchema.parse(input)
      const result = webExportTicketResultSchema.parse(
        await postJson(`${WEB_API_PREFIX}/files/export-ticket`, request),
      )
      if (!result.ok) return result
      this.exportTickets.set(result.value.path, result.value.ticket)
      return workspaceFilePathResultSchema.parse({ ok: true, value: result.value.path })
    } catch (error) {
      return failure(error)
    }
  }

  async pickMessageImages(): Promise<IpcResult<ImageAttachment[] | null>> {
    try {
      const files = await pickBrowserFiles('image/png,image/jpeg,image/webp,image/gif', true)
      if (files.length === 0) return { ok: true, value: null }
      const images = await Promise.all(
        files.map(async (file) =>
          imageAttachmentSchema.parse({
            data: await readFileBase64(file),
            mimeType: imageMimeType(file),
            name: file.name || null,
          }),
        ),
      )
      return workspaceImagePickerResultSchema.parse({ ok: true, value: images })
    } catch (error) {
      return failure(error)
    }
  }

  async onModuleInvocationSettled(
    moduleId: string,
    method: string,
    input: unknown,
    outcome: ModuleInvocationOutcome,
  ): Promise<void> {
    if (moduleId !== 'pictor.agent-workspace') return
    const path = readPath(input, method === 'importSession' ? 'sourcePath' : 'destinationPath')
    if (!path) return

    if (method === 'importSession') {
      const ticket = this.importTickets.get(path)
      if (!ticket) return
      this.importTickets.delete(path)
      await releaseTransfer(ticket)
      return
    }
    if (method !== 'exportSession') return
    const ticket = this.exportTickets.get(path)
    if (!ticket) return
    this.exportTickets.delete(path)
    if (outcome.status === 'fulfilled' && isSuccessfulWorkspaceResult(outcome.value)) {
      triggerDownload(`${WEB_API_PREFIX}/files/download/${encodeURIComponent(ticket)}`)
    } else {
      await releaseTransfer(ticket)
    }
  }

  stop(): void {
    const tickets = [...this.importTickets.values(), ...this.exportTickets.values()]
    this.importTickets.clear()
    this.exportTickets.clear()
    for (const ticket of tickets) void releaseTransfer(ticket)
  }

  private pickLocalPath(options: {
    title: string
    kind: PathPickerKind
    allowCreateDirectory: boolean
  }): Promise<string | null> {
    return new Promise((resolvePromise, reject) => {
      const dialog = document.createElement('dialog')
      dialog.className = 'pictor-web-picker'
      dialog.setAttribute('aria-label', options.title)
      dialog.innerHTML = `
        <form class="pictor-web-picker__surface" method="dialog">
          <header class="pictor-web-picker__header">
            <h2></h2>
            <button class="pictor-web-picker__close" type="button" aria-label="关闭">×</button>
          </header>
          <div class="pictor-web-picker__path-row">
            <button class="pictor-web-picker__up" type="button" title="上一级">↑</button>
            <input class="pictor-web-picker__path" aria-label="目录路径" spellcheck="false" />
            <button class="pictor-web-picker__go" type="button">打开</button>
          </div>
          <div class="pictor-web-picker__status" role="status"></div>
          <div class="pictor-web-picker__entries" role="list"></div>
          <footer class="pictor-web-picker__footer">
            <button class="pictor-web-picker__new" type="button">新建目录</button>
            <span></span>
            <button class="pictor-web-picker__cancel" type="button">取消</button>
            <button class="pictor-web-picker__select" type="button">选择当前目录</button>
          </footer>
        </form>`
      document.body.append(dialog)

      const title = requireElement<HTMLHeadingElement>(dialog, 'h2')
      const pathInput = requireElement<HTMLInputElement>(dialog, '.pictor-web-picker__path')
      const status = requireElement<HTMLDivElement>(dialog, '.pictor-web-picker__status')
      const entries = requireElement<HTMLDivElement>(dialog, '.pictor-web-picker__entries')
      const up = requireElement<HTMLButtonElement>(dialog, '.pictor-web-picker__up')
      const create = requireElement<HTMLButtonElement>(dialog, '.pictor-web-picker__new')
      let listing: WebDirectoryListing | null = null
      let settled = false

      title.textContent = options.title
      create.hidden = !options.allowCreateDirectory
      const finish = (value: string | null): void => {
        if (settled) return
        settled = true
        dialog.close()
        dialog.remove()
        resolvePromise(value)
      }
      const fail = (error: unknown): void => {
        if (settled) return
        settled = true
        dialog.remove()
        reject(error)
      }
      const load = async (path?: string): Promise<void> => {
        status.textContent = '正在读取目录'
        entries.replaceChildren()
        try {
          const query = path ? `?path=${encodeURIComponent(path)}` : ''
          const result = webDirectoryListingResultSchema.parse(
            await getJson(`${WEB_API_PREFIX}/files/directories${query}`),
          )
          if (!result.ok) throw new Error(result.error.message)
          listing = result.value
          pathInput.value = result.value.path
          up.disabled = result.value.parentPath === null
          status.textContent = `${result.value.entries.length} 个项目`
          renderEntries(result.value)
        } catch (error) {
          status.textContent = errorMessage(error)
        }
      }
      const renderEntries = (value: WebDirectoryListing): void => {
        entries.replaceChildren(
          ...value.entries.flatMap((entry) => {
            if (entry.kind === 'file' && options.kind !== 'pi-extension') return []
            if (
              entry.kind === 'file' &&
              !entry.name.toLowerCase().endsWith('.ts') &&
              !entry.name.toLowerCase().endsWith('.js')
            ) {
              return []
            }
            const button = document.createElement('button')
            button.type = 'button'
            button.className = 'pictor-web-picker__entry'
            button.setAttribute('role', 'listitem')
            button.innerHTML = `<span aria-hidden="true">${entry.kind === 'directory' ? '▸' : '·'}</span><strong></strong><small></small>`
            requireElement<HTMLElement>(button, 'strong').textContent = entry.name
            requireElement<HTMLElement>(button, 'small').textContent =
              entry.kind === 'directory' ? '目录' : '文件'
            button.addEventListener('click', () => {
              if (entry.kind === 'directory') void load(entry.path)
              else finish(entry.path)
            })
            return [button]
          }),
        )
      }

      requireElement<HTMLButtonElement>(dialog, '.pictor-web-picker__close').onclick = () =>
        finish(null)
      requireElement<HTMLButtonElement>(dialog, '.pictor-web-picker__cancel').onclick = () =>
        finish(null)
      requireElement<HTMLButtonElement>(dialog, '.pictor-web-picker__select').onclick = () =>
        finish(listing?.path ?? null)
      requireElement<HTMLButtonElement>(dialog, '.pictor-web-picker__go').onclick = () =>
        void load(pathInput.value)
      pathInput.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return
        event.preventDefault()
        void load(pathInput.value)
      })
      up.onclick = () => {
        if (listing?.parentPath) void load(listing.parentPath)
      }
      create.onclick = async () => {
        if (!listing) return
        const name = window.prompt('新目录名称')?.trim()
        if (!name) return
        status.textContent = '正在创建目录'
        try {
          const result = webDirectoryListingResultSchema.parse(
            await postJson(`${WEB_API_PREFIX}/files/directories`, {
              parentPath: listing.path,
              name,
            }),
          )
          if (!result.ok) throw new Error(result.error.message)
          listing = result.value
          pathInput.value = result.value.path
          status.textContent = `${result.value.entries.length} 个项目`
          renderEntries(result.value)
        } catch (error) {
          status.textContent = errorMessage(error)
        }
      }
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault()
        finish(null)
      })

      try {
        dialog.showModal()
        void load()
      } catch (error) {
        fail(error)
      }
    })
  }
}

function pluginTitle(source: GuiPluginSource): string {
  switch (source) {
    case 'local':
      return '选择 Pictor Plugin 目录'
    case 'development':
      return '选择 Development Plugin 目录'
    case 'pi-extension':
      return '选择 Pi Extension 文件或目录'
    case 'pi-package':
      return '选择 Pi Package 目录'
  }
}

function pickBrowserFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolvePromise) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multiple
    input.hidden = true
    document.body.append(input)
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      const files = [...(input.files ?? [])]
      input.remove()
      resolvePromise(files)
    }
    input.addEventListener('change', finish, { once: true })
    window.addEventListener('focus', () => setTimeout(finish, 0), { once: true })
    input.click()
  })
}

function readFileBase64(file: File): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('无法读取图片'))
    reader.onload = () => {
      const value = String(reader.result ?? '')
      const separator = value.indexOf(',')
      if (separator < 0) reject(new Error('图片编码无效'))
      else resolvePromise(value.slice(separator + 1))
    }
    reader.readAsDataURL(file)
  })
}

function imageMimeType(file: File): ImageAttachment['mimeType'] {
  if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
    return file.type as ImageAttachment['mimeType']
  }
  const extension = file.name.toLowerCase().split('.').at(-1)
  if (extension === 'png') return 'image/png'
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'gif') return 'image/gif'
  throw new Error(`不支持的图片格式：${file.name}`)
}

async function getJson(path: string): Promise<unknown> {
  return responseJson(await fetch(path, { credentials: 'same-origin' }))
}

async function postJson(path: string, input: unknown): Promise<unknown> {
  return responseJson(
    await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  )
}

async function responseJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(`Web Host request failed: HTTP ${response.status}`)
  return response.json()
}

async function releaseTransfer(ticket: string): Promise<void> {
  await postJson(`${WEB_API_PREFIX}/files/release`, { ticket }).catch(() => undefined)
}

function triggerDownload(url: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.hidden = true
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
}

function readPath(input: unknown, field: string): string | null {
  if (!input || typeof input !== 'object') return null
  const value = Reflect.get(input, field)
  return typeof value === 'string' ? value : null
}

function isSuccessfulWorkspaceResult(value: unknown): boolean {
  return Boolean(
    value &&
    typeof value === 'object' &&
    Reflect.get(value, 'ok') === true &&
    Reflect.get(value, 'value') === true,
  )
}

function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector)
  if (!element) throw new Error(`Missing Web picker element: ${selector}`)
  return element
}

function failure<T>(error: unknown): IpcResult<T> {
  return { ok: false, error: { code: 'internal', message: errorMessage(error) } }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
