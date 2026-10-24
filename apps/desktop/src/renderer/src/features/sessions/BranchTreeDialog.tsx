import { GitBranch } from 'lucide-react'
import { useMemo } from 'react'

import { useUiStore } from '../../app/ui-store.js'
import { useWorkspaceStore } from '../../app/workspace-store.js'
import { Button, Dialog } from '../../components/ui/index.js'
import { cn } from '../../lib/cn.js'
import { familyTree, type FamilyNode } from './family.js'

/** Indentation per level; deep families stay readable without a scrollbar. */
const INDENT = 16

/**
 * Every conversation that shares a lineage, drawn as a tree.
 *
 * Branching is how an idea splits, and a list of rows cannot show that: two
 * conversations named after the same prompt look unrelated. The tree puts each
 * branch under the conversation it came from and lets a click switch to it.
 */
export function BranchTreeDialog(): React.JSX.Element {
  const target = useUiStore((state) => state.branchTreeFor)
  const hide = useUiStore((state) => state.hideBranchTree)
  const sessions = useWorkspaceStore((state) => state.sessions)
  const selected = useWorkspaceStore((state) => state.selectedSessionId)
  const selectSession = useWorkspaceStore((state) => state.selectSession)

  const rows = useMemo(() => {
    const tree = familyTree(sessions, target)
    if (tree === null) return []
    const flattened: Array<{ node: FamilyNode; depth: number }> = []
    const walk = (node: FamilyNode, depth: number): void => {
      flattened.push({ node, depth })
      for (const child of node.children) walk(child, depth + 1)
    }
    walk(tree, 0)
    return flattened
  }, [sessions, target])

  return (
    <Dialog
      open={target !== null}
      title="分支树"
      onClose={hide}
      footer={
        <Button variant="ghost" size="sm" onClick={hide}>
          关闭
        </Button>
      }
    >
      <ul className="flex flex-col gap-0.5" aria-label="分支树">
        {rows.map(({ node, depth }) => {
          const current = node.session.id === selected
          return (
            <li key={node.session.id}>
              <button
                type="button"
                aria-current={current ? 'true' : undefined}
                style={{ paddingLeft: depth * INDENT + 8 }}
                onClick={() => {
                  selectSession(node.session.id)
                  hide()
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-xs transition-colors duration-150',
                  current
                    ? 'bg-surface-raised text-text'
                    : 'text-muted hover:bg-surface-hover hover:text-text',
                  depth > 0 && 'border-l border-border',
                )}
              >
                <GitBranch
                  className={cn('size-3 shrink-0', current ? 'text-accent' : 'text-faint')}
                />
                <span className="truncate">{node.session.title}</span>
                {current && <span className="ml-auto shrink-0 text-2xs text-accent">当前</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </Dialog>
  )
}
