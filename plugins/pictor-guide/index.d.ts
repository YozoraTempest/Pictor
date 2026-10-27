/**
 * The guide plugin is plain JavaScript — it is loaded by the app's plugin loader, not
 * compiled. This declaration exists so the app's own tests can call the function that
 * renders the skill and compare its path with the one discovery computes.
 */
export declare const name: string
export declare const inject: readonly string[]
export declare function skillBody(home?: string, environment?: NodeJS.ProcessEnv): string
export declare function apply(ctx: {
  effect: (work: () => () => void) => void
  pictor: {
    skills: (skill: {
      name: string
      description: string
      whenToUse?: string
      body: string
    }) => () => void
  }
}): void
