import { access, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { stdout } from 'node:process'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const electronDirectory = resolve(projectRoot, 'node_modules', 'electron')

const { version } = JSON.parse(await readFile(resolve(electronDirectory, 'package.json'), 'utf8'))

let runtimeFiles
try {
  runtimeFiles = await Promise.all([
    readFile(resolve(electronDirectory, 'path.txt'), 'utf8').then((value) => value.trim()),
    readFile(resolve(electronDirectory, 'dist', 'version'), 'utf8').then((value) =>
      value.trim().replace(/^v/, ''),
    ),
  ])
} catch (cause) {
  throw new Error('Electron runtime is missing. Run `npm run deps:prepare`.', { cause })
}

const [relativeExecutable, runtimeVersion] = runtimeFiles
if (!relativeExecutable) {
  throw new Error('Electron path.txt is empty. Run `npm run deps:prepare`.')
}
if (runtimeVersion !== version) {
  throw new Error(`Electron runtime version ${runtimeVersion} does not match package ${version}.`)
}

const executable = resolve(electronDirectory, 'dist', relativeExecutable)
await access(executable)

stdout.write(`Electron ${version} ready: ${executable}\n`)
