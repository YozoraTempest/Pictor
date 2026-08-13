import { platform } from 'node:process'

if (platform === 'win32') {
  await import('./verify-windows-package.mjs')
} else if (platform === 'linux') {
  await import('./verify-linux-packages.mjs')
} else {
  throw new Error(`Package verification is not supported on ${platform}`)
}
