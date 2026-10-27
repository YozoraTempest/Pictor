import {
  BookOpen,
  Braces,
  Bug,
  Cpu,
  Database,
  Download,
  FileDiff,
  FilePen,
  FileText,
  FolderOpen,
  FolderSearch,
  GitBranch,
  Globe,
  Hammer,
  Link,
  List,
  MessageSquare,
  Package,
  Search,
  Shield,
  Sparkles,
  Terminal,
  Upload,
  Wrench,
  type LucideIcon,
} from 'lucide-react'

import type { ToolViewDescriptor } from '../../../main/bridge.js'

import { registerToolView } from './tool-presenters.js'

/**
 * Icons a plugin may name, mapped to the renderer's own set.
 *
 * A closed list keeps the bundle from pulling in every lucide icon and keeps the
 * transcript's vocabulary consistent: a plugin says `terminal`, the renderer
 * decides what that looks like.
 */
const ICONS: Readonly<Record<string, LucideIcon>> = {
  'book-open': BookOpen,
  braces: Braces,
  bug: Bug,
  cpu: Cpu,
  database: Database,
  download: Download,
  'file-diff': FileDiff,
  'file-pen': FilePen,
  'file-text': FileText,
  'folder-open': FolderOpen,
  'folder-search': FolderSearch,
  'git-branch': GitBranch,
  globe: Globe,
  hammer: Hammer,
  link: Link,
  list: List,
  'message-square': MessageSquare,
  package: Package,
  search: Search,
  shield: Shield,
  sparkles: Sparkles,
  terminal: Terminal,
  upload: Upload,
  wrench: Wrench,
}

/** Icon for a contributed name; unknown names fall back to the terminal mark. */
export function iconForName(name: string | undefined): LucideIcon | undefined {
  if (name === undefined) return undefined
  return ICONS[name]
}

/**
 * Applies plugin tool views to the presenter registry.
 *
 * Each view only overrides label and icon: the sections a tool produces stay whatever
 * the built-in presenter says, so a plugin cannot change what a call actually did.
 * Patterns are registered as patterns, not expanded into tool names, because a
 * namespace view (`mcp__github__*`) covers tools that do not exist yet.
 */
export function applyToolViews(views: readonly ToolViewDescriptor[]): () => void {
  const disposers = views.flatMap((view) =>
    view.tools.map((pattern) =>
      registerToolView(pattern, {
        ...(view.label === undefined ? {} : { label: view.label }),
        ...(view.icon === undefined ? {} : { icon: iconForName(view.icon) }),
      }),
    ),
  )

  return () => {
    for (const dispose of disposers) dispose()
  }
}
