import { describe, expect, it } from 'vitest'

import type { Session } from '@vulonlok/shared'

import { familyRoot, familySize, familyTree } from './family.js'

function session(id: string, parentId: string | null, createdAt: number): Session {
  return {
    id,
    parentId,
    projectId: null,
    title: id,
    kernelId: 'dsh',
    piSessionId: null,
    pinned: false,
    archived: false,
    position: 0,
    sectionIds: [],
    createdAt,
    updatedAt: createdAt,
  }
}

/** root -> b1 -> c1, and root -> b2; plus an unrelated conversation. */
const family = [
  session('b2', 'root', 3),
  session('root', null, 1),
  session('b1', 'root', 2),
  session('c1', 'b1', 4),
  session('other', null, 5),
]

describe('familyRoot', () => {
  it('walks to the oldest ancestor', () => {
    expect(familyRoot(family, 'c1')?.id).toBe('root')
  })

  it('stops at a conversation whose parent is gone', () => {
    // `parent_id` is ON DELETE SET NULL, so a deleted parent leaves a root.
    const orphaned = session('orphan', null, 9)
    expect(familyRoot([...family, orphaned], 'orphan')?.id).toBe('orphan')
  })

  it('returns nothing for an unknown conversation', () => {
    expect(familyRoot(family, 'missing')).toBeNull()
    expect(familyRoot(family, null)).toBeNull()
  })
})

describe('familyTree', () => {
  it('nests each branch under the conversation it came from', () => {
    const tree = familyTree(family, 'c1')

    expect(tree?.session.id).toBe('root')
    expect(tree?.children.map((node) => node.session.id)).toEqual(['b1', 'b2'])
    expect(tree?.children[0]?.children.map((node) => node.session.id)).toEqual(['c1'])
  })

  it('roots the tree where the branch lineage starts, whichever node is asked for', () => {
    expect(familyTree(family, 'b2')?.session.id).toBe('root')
    expect(familyTree(family, 'root')?.session.id).toBe('root')
  })

  it('leaves unrelated conversations out', () => {
    const ids: string[] = []
    const walk = (node: { session: Session; children: unknown[] }): void => {
      ids.push(node.session.id)
      for (const child of node.children) walk(child as { session: Session; children: unknown[] })
    }
    const tree = familyTree(family, 'root')
    if (tree !== null) walk(tree)

    expect(ids).toEqual(['root', 'b1', 'c1', 'b2'])
  })
})

describe('familySize', () => {
  it('counts every conversation in the family', () => {
    expect(familySize(family, 'c1')).toBe(4)
    expect(familySize(family, 'b2')).toBe(4)
  })

  it('is one for a conversation nobody branched from', () => {
    expect(familySize(family, 'other')).toBe(1)
    expect(familySize(family, null)).toBe(0)
  })
})
