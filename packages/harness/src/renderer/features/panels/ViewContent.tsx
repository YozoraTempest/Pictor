import { Badge, Button, Spinner } from '@vulonlok/ui'
import { Markdown } from '../chat/Markdown.js'
import type { ViewBlock, ViewSpec } from '../../../main/bridge.js'

/**
 * One view's blocks, drawn with components this window owns.
 *
 * Shared by everything that shows a plugin's description: an opened panel, a seat in a
 * slot, and whatever comes next. Keeping one renderer is what makes the block vocabulary
 * mean the same thing everywhere — a `table` in `shell.bottom` looks like a `table` in
 * the right column.
 */
export function ViewContent({
  spec,
  onAction,
  busy = null,
}: {
  spec: ViewSpec
  /**
   * Presses one of the view's buttons.
   *
   * Required, because every host has the channel: the click names the action here, the
   * plugin's handler runs next to the plugin, and the answer comes back as a description.
   * A view with no handler answers with a failure, which the host shows — silence would
   * look like a dead button.
   */
  onAction: (action: string, value: string | undefined) => void
  /** The `action` id currently in flight, so its button can say so. */
  busy?: string | null
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2.5">
      {spec.blocks.length === 0 ? (
        <p className="text-2xs leading-relaxed text-faint">这个视图没有内容。</p>
      ) : (
        spec.blocks.map((block, index) => (
          // Blocks are positional: two identical paragraphs are two blocks.
          <Block key={String(index)} block={block} onAction={onAction} busy={busy} />
        ))
      )}

      {spec.note !== undefined && (
        <p className="mt-1 border-t border-border pt-2 text-2xs leading-relaxed text-faint">
          {spec.note}
        </p>
      )}
    </div>
  )
}

/** One block. The vocabulary is closed: every case here is one the SDK validates. */
function Block({
  block,
  onAction,
  busy,
}: {
  block: ViewBlock
  onAction: (action: string, value: string | undefined) => void
  busy: string | null
}): React.JSX.Element {
  switch (block.kind) {
    case 'heading':
      return <h3 className="text-xs font-semibold text-text">{block.text}</h3>
    case 'text':
      return <p className="text-2xs leading-relaxed whitespace-pre-wrap text-muted">{block.text}</p>
    case 'markdown':
      // Same renderer as the transcript, at the panel's own density.
      return <Markdown text={block.text} className="text-2xs text-muted" />
    case 'code':
      return (
        // Code keeps its own line breaks; a wrapped line would read as two.
        <pre className="selectable overflow-x-auto rounded-md border border-border bg-bg px-2.5 py-2 font-mono text-2xs leading-relaxed whitespace-pre">
          {block.text}
        </pre>
      )
    case 'list':
      return block.ordered === true ? (
        <ol className="flex list-decimal flex-col gap-1 pl-4 text-2xs leading-relaxed text-muted">
          {block.items.map((item, index) => (
            <li key={String(index)}>{item}</li>
          ))}
        </ol>
      ) : (
        <ul className="flex list-disc flex-col gap-1 pl-4 text-2xs leading-relaxed text-muted">
          {block.items.map((item, index) => (
            <li key={String(index)}>{item}</li>
          ))}
        </ul>
      )
    case 'keyValue':
      return (
        <dl className="flex flex-col gap-1">
          {block.rows.map((row, index) => (
            <div key={String(index)} className="flex items-baseline gap-2 text-2xs">
              <dt className="w-20 shrink-0 truncate text-faint">{row.label}</dt>
              <dd className="min-w-0 flex-1 break-words text-muted">{row.value}</dd>
            </div>
          ))}
        </dl>
      )
    case 'table':
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-2xs">
            <thead>
              <tr>
                {block.columns.map((column, index) => (
                  <th
                    key={String(index)}
                    className="border-b border-border px-2 py-1 text-left font-medium text-faint"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={String(rowIndex)}>
                  {row.map((cell, cellIndex) => (
                    <td
                      key={String(cellIndex)}
                      className="border-b border-border/60 px-2 py-1 align-top text-muted"
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'badge':
      return (
        <div>
          <Badge tone={block.tone ?? 'neutral'}>{block.label}</Badge>
        </div>
      )
    case 'button': {
      const pending = busy === block.action
      return (
        <div>
          <Button
            size="sm"
            variant={
              block.tone === 'danger' ? 'danger' : block.tone === 'accent' ? 'primary' : 'secondary'
            }
            disabled={pending}
            onClick={() => onAction(block.action, block.value)}
          >
            {pending && <Spinner className="mr-1 size-3" />}
            {block.label}
          </Button>
        </div>
      )
    }
    case 'divider':
      return <hr className="border-border" />
  }
}
