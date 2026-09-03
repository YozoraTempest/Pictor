import process from 'node:process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createNodeCliDependencies } from './node-adapter.js'
import { runCli } from './run.js'
import { assertPackagedNodeFrontend } from '../node/frontend-identity.js'

export async function main(arguments_: readonly string[] = process.argv.slice(2)): Promise<number> {
  assertPackagedNodeFrontend()
  const result = await runCli(arguments_, createNodeCliDependencies())
  process.exitCode = result.exitCode
  return result.exitCode
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main()
}
