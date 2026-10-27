export type DiffLineKind = 'add' | 'remove' | 'context'

export interface DiffLine {
  kind: DiffLineKind
  text: string
}

/** Above this many lines the quadratic table is not worth it; show a full swap. */
const MAX_LINES = 400

/**
 * Line diff between two strings.
 *
 * Small, dependency-free LCS: `edit` only ever sees a handful of lines, and a
 * real diff library would be a lot of weight for one tool section. Pathological
 * sizes fall back to "everything replaced" so the transcript cannot stall.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = split(before)
  const b = split(after)

  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    return [
      ...a.map((text): DiffLine => ({ kind: 'remove', text })),
      ...b.map((text): DiffLine => ({ kind: 'add', text })),
    ]
  }

  // lengths[i][j] = LCS length of a[i:] and b[j:]
  const lengths: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  )

  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      const row = lengths[i]
      const next = lengths[i + 1]
      if (row === undefined || next === undefined) continue

      row[j] = a[i] === b[j] ? (next[j + 1] ?? 0) + 1 : Math.max(next[j] ?? 0, row[j + 1] ?? 0)
    }
  }

  const lines: DiffLine[] = []
  let i = 0
  let j = 0

  while (i < a.length && j < b.length) {
    const left = a[i] ?? ''
    const right = b[j] ?? ''

    if (left === right) {
      lines.push({ kind: 'context', text: left })
      i += 1
      j += 1
      continue
    }

    const dropLeft = lengths[i + 1]?.[j] ?? 0
    const dropRight = lengths[i]?.[j + 1] ?? 0

    if (dropLeft >= dropRight) {
      lines.push({ kind: 'remove', text: left })
      i += 1
    } else {
      lines.push({ kind: 'add', text: right })
      j += 1
    }
  }

  for (; i < a.length; i += 1) lines.push({ kind: 'remove', text: a[i] ?? '' })
  for (; j < b.length; j += 1) lines.push({ kind: 'add', text: b[j] ?? '' })

  return lines
}

/** Unified-style text: `-` removed, `+` added, two spaces for context. */
export function formatDiff(lines: readonly DiffLine[]): string {
  return lines
    .map((line) => `${line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' '}${line.text}`)
    .join('\n')
}

function split(text: string): string[] {
  return text.length === 0 ? [] : text.split('\n')
}
