import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

import type { SkillContribution } from '@vulonlok/plugin-sdk'
import type { SkillEntry, SkillLibraryView, SkillOrigin } from '@vulonlok/shared'

/** Marker written beside every file Pictor owns, so a later run knows it may move it. */
const MARKER = '.pictor.json'

interface Marker {
  owner: 'plugin' | 'library' | 'placeholder'
  /** Plugin that contributed the skill, for `owner: 'plugin'`. */
  pluginId?: string
  name: string
  description: string
  whenToUse?: string
}

interface DisabledRecord {
  name: string
  description: string
  whenToUse: string | null
  path: string | null
  origin: SkillOrigin
}

interface LibraryState {
  disabled: DisabledRecord[]
}

export interface SkillLibraryOptions {
  /** Root the runtime scans as the user skill root; Pictor writes here. */
  root: string
  /** Where switched-off managed skills wait, outside every scanned root. */
  stash: string
  /** JSON file recording switches that apply to files Pictor does not own. */
  stateFile: string
  logger?: (message: string) => void
}

/** One line of YAML, quoted so a colon or a quote in a description stays literal. */
function yamlLine(key: string, value: string): string {
  return `${key}: ${JSON.stringify(value)}`
}

/**
 * Renders one skill as the `SKILL.md` the runtime reads.
 *
 * The invocation switches are written as the negatives the format uses
 * (`disable-model-invocation`, `user-invocable: false`) and only when narrowed:
 * a skill that omits them is open on both surfaces, which is the default.
 */
export function renderSkillFile(skill: SkillContribution): string {
  const front = ['---', yamlLine('name', skill.name), yamlLine('description', skill.description)]
  if (skill.whenToUse !== undefined) front.push(yamlLine('whenToUse', skill.whenToUse))
  if (skill.userInvocable === false) front.push('user-invocable: false')
  if (skill.modelInvocable === false) front.push('disable-model-invocation: true')
  front.push('---', '')
  return `${front.join('\n')}\n${skill.body}\n`
}

/** A skill that exists only to hide an external one with the same name. */
function renderPlaceholder(name: string, description: string, whenToUse: string | null): string {
  const front = [
    '---',
    yamlLine('name', name),
    yamlLine('description', description),
    ...(whenToUse === null ? [] : [yamlLine('whenToUse', whenToUse)]),
    'user-invocable: false',
    'disable-model-invocation: true',
    '---',
    '',
    '这个技能已在 Pictor 设置里停用。',
  ]
  return `${front.join('\n')}\n`
}

/**
 * Pictor's own skill root, and the switches that apply to skills it did not write.
 *
 * The runtime has no per-skill disable: it reports whatever its roots contain.
 * So a skill Pictor owns is switched off by moving it out of every scanned root,
 * and one the user wrote is switched off by writing a same-named placeholder that
 * is invisible on both surfaces — the runtime's roots are ranked, and Pictor's
 * root outranks the user's own, so the placeholder shadows the original without
 * touching the file. A project skill outranks Pictor's root, which is why that
 * case is refused instead of silently doing nothing.
 */
export class SkillLibrary {
  readonly #options: SkillLibraryOptions
  readonly #warn: (message: string) => void

  constructor(options: SkillLibraryOptions) {
    this.#options = options
    this.#warn = options.logger ?? ((message) => console.warn(`[skill] ${message}`))
  }

  get root(): string {
    return this.#options.root
  }

  /** What the renderer needs; read from disk every time a list is asked for. */
  view(): SkillLibraryView {
    const managed = new Map<string, { origin: 'plugin' | 'library'; source: string | null }>()
    for (const entry of this.#entries(this.#options.root)) {
      if (entry.marker.owner === 'placeholder') continue
      managed.set(entry.marker.name, {
        origin: entry.marker.owner === 'plugin' ? 'plugin' : 'library',
        source: entry.marker.owner === 'plugin' ? (entry.marker.pluginId ?? null) : null,
      })
    }

    const stashed = this.#entries(this.#options.stash).map((entry) => ({
      name: entry.marker.name,
      description: entry.marker.description,
      whenToUse: entry.marker.whenToUse ?? null,
      source: entry.marker.owner === 'plugin' ? (entry.marker.pluginId ?? null) : null,
    }))

    return { root: this.#options.root, managed, stashed, disabled: this.#state().disabled }
  }

  /**
   * The skills Pictor owns, without a conversation.
   *
   * The runtime resolves a catalog per session, so a person who has not opened one sees
   * nothing. These entries do not depend on that: they are the files in Pictor's own
   * root plus whatever a plugin contributed, with the switches beside them. Filesystem
   * and project skills are absent on purpose — neither can be listed without knowing
   * which directories a conversation would scan.
   */
  entries(): SkillEntry[] {
    const live: SkillEntry[] = []
    for (const entry of this.#entries(this.#options.root)) {
      if (entry.marker.owner === 'placeholder') continue
      live.push({
        name: entry.marker.name,
        description: entry.marker.description,
        whenToUse: entry.marker.whenToUse ?? null,
        path: join(entry.directory, 'SKILL.md'),
        modelInvocable: true,
        origin: entry.marker.owner === 'plugin' ? 'plugin' : 'library',
        enabled: true,
        source: entry.marker.owner === 'plugin' ? (entry.marker.pluginId ?? null) : null,
      })
    }

    const off: SkillEntry[] = this.#entries(this.#options.stash).map((entry) => ({
      name: entry.marker.name,
      description: entry.marker.description,
      whenToUse: entry.marker.whenToUse ?? null,
      path: join(entry.directory, 'SKILL.md'),
      modelInvocable: true,
      origin: entry.marker.owner === 'plugin' ? 'plugin' : 'library',
      enabled: false,
      source: entry.marker.owner === 'plugin' ? (entry.marker.pluginId ?? null) : null,
    }))

    // A skill the user wrote and switched off lives where it always did; only the
    // placeholder here remembers it, and that snapshot is the whole of what is known.
    const known = new Set(live.map((entry) => entry.name))
    for (const record of this.#state().disabled) {
      if (known.has(record.name)) continue
      off.push({ ...record, modelInvocable: true, enabled: false, source: null })
    }

    return [...live, ...off]
  }

  /**
   * Writes one plugin's skills and drops the ones it stopped contributing.
   *
   * A name already used by something Pictor does not own is refused: overwriting
   * a file someone wrote by hand is not something a plugin activation may do.
   */
  syncPlugin(pluginId: string, skills: readonly SkillContribution[]): void {
    mkdirSync(this.#options.root, { recursive: true })
    const wanted = new Set(skills.map((skill) => skill.name))

    for (const skill of skills) {
      const stashedDirectory = join(this.#options.stash, skill.name)
      const stashedMarker = this.#markerIn(stashedDirectory)
      if (
        stashedMarker !== null &&
        stashedMarker.owner === 'plugin' &&
        stashedMarker.pluginId === pluginId
      ) {
        // Someone switched this one off. Keep it off across activations, but
        // rewrite the stashed copy so the next enable loads the current body.
        this.#write(stashedDirectory, renderSkillFile(skill), {
          owner: 'plugin',
          pluginId,
          name: skill.name,
          description: skill.description,
          ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }),
        })
        continue
      }

      const directory = join(this.#options.root, skill.name)
      const existing = this.#markerIn(directory)
      if (existing !== null && existing.owner !== 'placeholder' && existing.pluginId !== pluginId) {
        this.#warn(`跳过 ${skill.name}：同名技能已存在，Pictor 不会覆盖`)
        continue
      }
      if (existing === null && existsSync(directory)) {
        this.#warn(`跳过 ${skill.name}：${directory} 已存在且不是 Pictor 写的`)
        continue
      }
      this.#write(directory, renderSkillFile(skill), {
        owner: 'plugin',
        pluginId,
        name: skill.name,
        description: skill.description,
        ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }),
      })
    }

    for (const entry of this.#entries(this.#options.root)) {
      if (entry.marker.owner !== 'plugin' || entry.marker.pluginId !== pluginId) continue
      if (wanted.has(entry.marker.name)) continue
      this.#remove(entry.directory)
    }
    // A plugin that was switched off while its skills were stashed must not come
    // back when someone re-enables the skill.
    for (const entry of this.#entries(this.#options.stash)) {
      if (entry.marker.owner !== 'plugin' || entry.marker.pluginId !== pluginId) continue
      if (wanted.has(entry.marker.name)) continue
      this.#remove(entry.directory)
    }
  }

  /** Removes every skill one plugin owns, in both roots. */
  clearPlugin(pluginId: string): void {
    for (const root of [this.#options.root, this.#options.stash]) {
      for (const entry of this.#entries(root)) {
        if (entry.marker.owner !== 'plugin' || entry.marker.pluginId !== pluginId) continue
        this.#remove(entry.directory)
      }
    }
  }

  /**
   * Switches one skill on or off.
   *
   * `snapshot` describes the skill as the runtime reported it, and is only used
   * when the file belongs to someone else: the placeholder has to describe what
   * it is hiding, and the list has to keep showing the row afterwards.
   */
  setEnabled(name: string, enabled: boolean, snapshot: DisabledRecord): void {
    if (snapshot.origin === 'project') {
      throw new Error('项目里的技能由仓库决定，Pictor 不能停用')
    }

    const liveDirectory = join(this.#options.root, name)
    const stashedDirectory = join(this.#options.stash, name)
    const liveMarker = this.#markerIn(liveDirectory)
    const stashedMarker = this.#markerIn(stashedDirectory)
    const managed = liveMarker?.owner === 'plugin' || liveMarker?.owner === 'library'
    const stashed = stashedMarker?.owner === 'plugin' || stashedMarker?.owner === 'library'

    if (enabled) {
      if (stashed) {
        mkdirSync(this.#options.root, { recursive: true })
        renameSync(stashedDirectory, liveDirectory)
      }
      if (liveMarker?.owner === 'placeholder') this.#remove(liveDirectory)
      this.#dropRecord(name)
      return
    }

    if (managed) {
      mkdirSync(this.#options.stash, { recursive: true })
      if (existsSync(stashedDirectory)) this.#remove(stashedDirectory)
      renameSync(liveDirectory, stashedDirectory)
      return
    }

    // Someone else's file: shadow it with a placeholder that no surface offers.
    if (liveMarker !== null && liveMarker.owner !== 'placeholder') {
      throw new Error(`${name} 由 Pictor 之外的来源提供，无法停用`)
    }
    if (liveMarker === null && existsSync(liveDirectory)) {
      throw new Error(`${name} 的目录已存在且不是 Pictor 写的，拒绝覆盖`)
    }
    this.#write(liveDirectory, renderPlaceholder(name, snapshot.description, snapshot.whenToUse), {
      owner: 'placeholder',
      name,
      description: snapshot.description,
      ...(snapshot.whenToUse === null ? {} : { whenToUse: snapshot.whenToUse }),
    })
    this.#record({ ...snapshot, name })
  }

  #state(): LibraryState {
    const file = this.#options.stateFile
    if (!existsSync(file)) return { disabled: [] }
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<LibraryState>
      const disabled = Array.isArray(parsed.disabled)
        ? parsed.disabled.filter(
            (entry): entry is DisabledRecord =>
              typeof entry === 'object' &&
              entry !== null &&
              typeof (entry as DisabledRecord).name === 'string' &&
              typeof (entry as DisabledRecord).description === 'string',
          )
        : []
      return { disabled }
    } catch {
      this.#warn(`${file} 无法解析，按没有停用记录处理`)
      return { disabled: [] }
    }
  }

  #save(state: LibraryState): void {
    mkdirSync(dirname(this.#options.stateFile), { recursive: true })
    writeFileSync(this.#options.stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  }

  #record(entry: DisabledRecord): void {
    const state = this.#state()
    const next = state.disabled.filter((item) => item.name !== entry.name)
    next.push(entry)
    this.#save({ disabled: next })
  }

  #dropRecord(name: string): void {
    const state = this.#state()
    const next = state.disabled.filter((item) => item.name !== name)
    if (next.length === state.disabled.length) return
    this.#save({ disabled: next })
  }

  #markerIn(directory: string): Marker | null {
    const file = join(directory, MARKER)
    if (!existsSync(file)) return null
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as Marker
    } catch {
      return null
    }
  }

  #entries(root: string): { directory: string; marker: Marker }[] {
    if (!existsSync(root)) return []
    return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
      if (!entry.isDirectory()) return []
      const directory = join(root, entry.name)
      const marker = this.#markerIn(directory)
      return marker === null ? [] : [{ directory, marker }]
    })
  }

  #write(directory: string, content: string, marker: Marker): void {
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'SKILL.md'), content, 'utf8')
    writeFileSync(join(directory, MARKER), `${JSON.stringify(marker, null, 2)}\n`, 'utf8')
  }

  /** Only ever removes a directory Pictor marked; anything else is left alone. */
  #remove(directory: string): void {
    if (this.#markerIn(directory) === null) return
    rmSync(directory, { recursive: true, force: true })
  }
}
