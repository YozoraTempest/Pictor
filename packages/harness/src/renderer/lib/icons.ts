import {
  Blocks,
  Boxes,
  Globe,
  MessagesSquare,
  Plus,
  Puzzle,
  Radio,
  Settings2,
  Terminal,
  Wrench,
  type LucideIcon,
} from 'lucide-react'

/**
 * The icon vocabulary a contribution may name.
 *
 * One table for both plugin panels and kernels, because it is one decision: a
 * contribution names an icon and the window decides what that means. An unknown name
 * draws the generic icon — a rail button with nothing in it looks broken rather than
 * merely unconfigured, and a plugin from the future should still be reachable.
 */
const ICONS: Readonly<Record<string, LucideIcon>> = {
  blocks: Blocks,
  boxes: Boxes,
  globe: Globe,
  'messages-square': MessagesSquare,
  plus: Plus,
  puzzle: Puzzle,
  radio: Radio,
  settings: Settings2,
  terminal: Terminal,
  wrench: Wrench,
}

export function iconFor(
  name: string | null | undefined,
  fallback: LucideIcon = Wrench,
): LucideIcon {
  if (name === null || name === undefined) return fallback
  return ICONS[name] ?? fallback
}
