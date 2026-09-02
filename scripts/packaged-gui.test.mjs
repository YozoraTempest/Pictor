import { describe, expect, it } from 'vitest'

import {
  findWindowsPackagedPageTarget,
  PACKAGED_GUI_LAUNCH_MODES,
  selectPackagedGuiLaunchMode,
  windowsProcessTreeKillArguments,
} from './packaged-gui.mjs'

describe('packaged GUI launch routing', () => {
  it('uses Playwright Electron for a Windows executable and HTTP for its cmd launcher', () => {
    expect(selectPackagedGuiLaunchMode('C:\\Program Files\\Pictor\\Pictor.exe', 'win32')).toBe(
      PACKAGED_GUI_LAUNCH_MODES.ELECTRON,
    )
    expect(selectPackagedGuiLaunchMode('C:\\Program Files\\Pictor\\bin\\pictor.CMD', 'win32')).toBe(
      PACKAGED_GUI_LAUNCH_MODES.WINDOWS_LAUNCHER_HTTP,
    )
  })

  it('keeps the Linux executable on the existing CDP path', () => {
    expect(selectPackagedGuiLaunchMode('/opt/Pictor/pictor', 'linux')).toBe(
      PACKAGED_GUI_LAUNCH_MODES.CDP,
    )
    expect(selectPackagedGuiLaunchMode('/opt/Pictor/Pictor.exe', 'linux')).toBe(
      PACKAGED_GUI_LAUNCH_MODES.CDP,
    )
  })
})

describe('Windows launcher HTTP probe', () => {
  it('accepts only the packaged app page target', () => {
    const packagedPage = {
      type: 'page',
      url: 'app://bundle/index.html',
      title: 'Pictor',
    }

    expect(
      findWindowsPackagedPageTarget([
        { type: 'page', url: 'devtools://devtools/bundled/inspector.html' },
        { type: 'service_worker', url: 'app://bundle/index.html' },
        packagedPage,
      ]),
    ).toEqual(packagedPage)
    expect(findWindowsPackagedPageTarget([{ type: 'page', url: 'http://localhost' }])).toBeNull()
  })

  it('closes the cmd root with its complete Windows process tree', () => {
    expect(windowsProcessTreeKillArguments(4321)).toEqual([
      '/d',
      '/c',
      'taskkill.exe',
      '/PID',
      '4321',
      '/T',
      '/F',
    ])
  })
})
