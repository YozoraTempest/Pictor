import * as React from 'react'
import * as jsxDevRuntime from 'react/jsx-dev-runtime'
import * as jsxRuntime from 'react/jsx-runtime'

import { startGui } from '../gui/index.js'
import '../gui/styles.css'

const root = document.getElementById('root')

if (!root) {
  throw new Error('Missing renderer root element')
}

Object.assign(globalThis, {
  __PICTOR_REACT__: React,
  __PICTOR_JSX_RUNTIME__: jsxRuntime,
  __PICTOR_JSX_DEV_RUNTIME__: jsxDevRuntime,
})

void startGui(root)
