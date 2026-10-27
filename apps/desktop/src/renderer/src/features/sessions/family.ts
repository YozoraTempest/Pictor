import type { Session } from '@vulonlok/shared'

/** One conversation in a family tree, with the branches that came from it. */
export interface FamilyNode {
  session: Session
  children: FamilyNode[]
}

/** How deep a lineage walk may go before it must be a cycle. */
const MAX_DEPTH = 64

/** The conversation a branch came from, if it still exists. */
function parentOf(sessions: readonly Session[], session: Session): Session | null {
  if (session.parentId === null) return null
  return sessions.find((entry) => entry.id === session.parentId) ?? null
}

/**
 * Oldest ancestor of a conversation.
 *
 * `parent_id` is `ON DELETE SET NULL`, so deleting a parent makes its branches
 * roots of their own — the walk simply stops there.
 */
export function familyRoot(sessions: readonly Session[], id: string | null): Session | null {
  if (id === null) return null
  let current = sessions.find((entry) => entry.id === id) ?? null
  const seen = new Set<string>()

  for (let depth = 0; current !== null && depth < MAX_DEPTH; depth += 1) {
    if (seen.has(current.id)) break
    seen.add(current.id)
    const parent = parentOf(sessions, current)
    if (parent === null) return current
    current = parent
  }

  return current
}

/** Branches in the order they were created, which is how they were branched. */
function byCreation(a: Session, b: Session): number {
  return a.createdAt - b.createdAt
}

/**
 * The whole family as a tree, rooted where this conversation's lineage starts.
 *
 * A conversation is drawn under the one it was branched from, so a reader can see
 * where an idea split without opening every row.
 */
export function familyTree(sessions: readonly Session[], id: string | null): FamilyNode | null {
  const root = familyRoot(sessions, id)
  if (root === null) return null

  const childrenOf = new Map<string, Session[]>()
  for (const session of sessions) {
    if (session.parentId === null) continue
    const list = childrenOf.get(session.parentId) ?? []
    list.push(session)
    childrenOf.set(session.parentId, list)
  }

  const build = (session: Session, depth: number): FamilyNode => {
    // A cycle would otherwise recurse forever; depth is the cheap guard.
    const children = depth >= MAX_DEPTH ? [] : (childrenOf.get(session.id) ?? [])
    return {
      session,
      children: [...children].sort(byCreation).map((child) => build(child, depth + 1)),
    }
  }

  return build(root, 0)
}

/** Conversations in the same family, this one included. */
export function familySize(sessions: readonly Session[], id: string | null): number {
  const tree = familyTree(sessions, id)
  if (tree === null) return 0

  const count = (node: FamilyNode): number =>
    1 + node.children.reduce((total, child) => total + count(child), 0)
  return count(tree)
}
