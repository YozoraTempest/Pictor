// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * jsdom has no media queries, and the UI store reads one while it is being built —
 * before any test body runs. So the stub has to exist before the imports below.
 */
vi.hoisted(() => {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('min-width'),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
})

import type { Session } from '@pictor/shared'

import { openSession } from './open-session.js'
import { useUiStore } from './ui-store.js'
import { useWorkspaceStore } from './workspace-store.js'

/** The least a conversation needs to be found by `openSession`. */
function session(id: string, kernelId: string): Session {
  return {
    id,
    title: id,
    projectId: null,
    kernelId,
    piSessionId: null,
    parentId: null,
    pinned: false,
    archived: false,
    position: 0,
    createdAt: 0,
    updatedAt: 0,
    sectionIds: [],
  }
}

beforeEach(() => {
  useUiStore.setState({ view: 'home' })
  useWorkspaceStore.setState({
    sessions: [session('pi-1', 'pi'), session('dsh-1', 'dsh')],
    selectedSessionId: null,
    selectedProjectId: null,
  })
})

describe('openSession', () => {
  it('opens the page the conversation lives on, then selects it', () => {
    // A conversation is listed only on its own kernel's page, so jumping to it is
    // two moves — and the page has to come first, or it opens somewhere that does
    // not list it.
    expect(openSession('pi-1')).toBe(true)
    expect(useUiStore.getState().view).toBe('pi')
    expect(useWorkspaceStore.getState().selectedSessionId).toBe('pi-1')

    expect(openSession('dsh-1')).toBe(true)
    expect(useUiStore.getState().view).toBe('dsh')
    expect(useWorkspaceStore.getState().selectedSessionId).toBe('dsh-1')
  })

  it('falls back to the overview for a kernel without a page', () => {
    // A conversation filed under a kernel this build has no page for is still
    // listed on the overview, so that is where the reader can reach it.
    useWorkspaceStore.setState({ sessions: [session('codex-1', 'codex')] })

    expect(openSession('codex-1')).toBe(true)
    expect(useUiStore.getState().view).toBe('home')
    expect(useWorkspaceStore.getState().selectedSessionId).toBe('codex-1')
  })

  it('refuses a conversation that is not there, instead of navigating nowhere', () => {
    // A deleted conversation, or one whose creation failed: a "go there" button that
    // silently changed the page would be worse than one that does nothing.
    expect(openSession('gone')).toBe(false)
    expect(useUiStore.getState().view).toBe('home')
    expect(useWorkspaceStore.getState().selectedSessionId).toBeNull()
  })
})
