/**
 * Moved: the bridge's shape belongs to the harness now.
 *
 * `@vulonlok/harness/main/bridge` is the file; this is the seam left behind so the window's
 * imports did not have to change in the same commit that moved it. It goes away once every
 * caller imports the package.
 */
export * from '@vulonlok/harness/main/bridge'
