export const CLI_EXIT_CODES = Object.freeze({
  success: 0,
  failure: 1,
  usage: 2,
  profileConflict: 4,
  cancelled: 130,
} as const)

export type CliExitCode = (typeof CLI_EXIT_CODES)[keyof typeof CLI_EXIT_CODES]
