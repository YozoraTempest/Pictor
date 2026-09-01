import { Info } from 'lucide-react'
import { expect, it } from 'vitest'

import * as guiContract from './contract.js'

it('keeps the public GUI contribution surface narrow and owned', () => {
  expect(guiContract.guiWorkbenchContributions.id).toBe('gui.workbenches')
  expect(guiContract.guiSettingsSectionContributions.id).toBe('gui.settings-sections')
  expect(guiContract.guiSettingsSectionContributions.id).not.toBe('shell.settings-sections')

  const section: guiContract.GuiSettingsSectionContribution = {
    id: 'pictor.example.settings',
    owner: 'pictor.example',
    label: 'Example',
    icon: Info,
    render: ({ commandClient, pluginPicker, guiPluginStatuses }) => {
      expect(commandClient).toBeDefined()
      expect(pluginPicker).toBeDefined()
      expect(guiPluginStatuses).toBeDefined()
      return null
    },
  }
  expect(section).toMatchObject({ id: 'pictor.example.settings', owner: 'pictor.example' })

  expect(guiContract).not.toHaveProperty('guiOverlayContributions')
  expect(guiContract).not.toHaveProperty('guiNotificationContributions')
})
