import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Where a plugin someone is *writing* lives.
 *
 * Two kinds of plugin, two homes: one shipped with the app (read-only, replaced on upgrade)
 * and one installed into the profile. A third case has no home until now — a folder being
 * worked on right now, which wants to be a plain project directory: under version control,
 * opened in an editor, deleted when it was an experiment.
 *
 * So it is a directory of the person's own rather than app data. `<home>/Pictor/plugins`
 * reads well in a file manager and can be a git repository on its own, which a hidden
 * `~/.config/pictor/plugins` cannot be without explaining itself.
 *
 * Anything dropped here is discovered and mounted, and a watcher notices the directory
 * appearing or going away — so writing files is the whole workflow.
 */
export function developmentPluginsDirectory(
  environment: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  // Pointed elsewhere on purpose by whoever started the app: a checkout of a plugins
  // repository, a shared directory, or a test run that must not touch a real home.
  const override = environment['PICTOR_DEVELOPMENT_PLUGINS']
  if (override !== undefined && override.length > 0) return resolve(override)
  return join(home, 'Pictor', 'plugins')
}
