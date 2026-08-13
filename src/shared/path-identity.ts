export type DesktopPlatform = 'win32' | 'linux'

function comparablePath(path: string, platform: DesktopPlatform): string {
  return platform === 'win32' ? path.toLocaleLowerCase('en-US') : path
}

export function pathsReferToSameLocation(
  left: string,
  right: string,
  platform: DesktopPlatform,
): boolean {
  return comparablePath(left, platform) === comparablePath(right, platform)
}
