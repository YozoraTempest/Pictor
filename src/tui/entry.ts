import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { createNodeTuiDependencies } from './node-adapter.js'
import { runTui } from './run.js'

export async function main(arguments_: readonly string[] = process.argv.slice(2)): Promise<number> {
  const result = await runTui(arguments_, createNodeTuiDependencies())
  process.exitCode = result.exitCode
  return result.exitCode
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
