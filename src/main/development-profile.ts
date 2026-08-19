import { join } from 'node:path'

export function developmentUserDataPath(
  appData: string,
  isPackaged: boolean,
  arguments_: readonly string[],
): string | null {
  if (
    isPackaged ||
    arguments_.some(
      (argument) => argument === '--user-data-dir' || argument.startsWith('--user-data-dir='),
    )
  ) {
    return null
  }
  return join(appData, 'pictor-dev')
}
