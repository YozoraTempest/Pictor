import { Buffer } from 'node:buffer'
import { access, open, readFile, stat } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { stdout } from 'node:process'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageMetadata = JSON.parse(await readFile(resolve(repositoryRoot, 'package.json'), 'utf8'))
const outputDirectory = resolve(repositoryRoot, 'dist')
const installerName = `Pictor-${packageMetadata.version}-windows-x64-setup.exe`
const artifacts = {
  installer: resolve(outputDirectory, installerName),
  executable: resolve(outputDirectory, 'win-unpacked', 'Pictor.exe'),
  applicationArchive: resolve(outputDirectory, 'win-unpacked', 'resources', 'app.asar'),
}

async function requireNonEmptyFile(path) {
  await access(path)
  const metadata = await stat(path)
  if (!metadata.isFile() || metadata.size === 0) {
    throw new Error(`Expected a non-empty file: ${relative(repositoryRoot, path)}`)
  }
  return metadata.size
}

async function readPeMachine(path) {
  const handle = await open(path, 'r')
  try {
    const dosHeader = Buffer.alloc(64)
    await handle.read(dosHeader, 0, dosHeader.length, 0)
    if (dosHeader.toString('ascii', 0, 2) !== 'MZ') {
      throw new Error(`Expected a PE executable: ${relative(repositoryRoot, path)}`)
    }

    const peOffset = dosHeader.readUInt32LE(0x3c)
    const peHeader = Buffer.alloc(6)
    await handle.read(peHeader, 0, peHeader.length, peOffset)
    if (peHeader.toString('ascii', 0, 4) !== 'PE\0\0') {
      throw new Error(`Expected a valid PE header: ${relative(repositoryRoot, path)}`)
    }
    return peHeader.readUInt16LE(4)
  } finally {
    await handle.close()
  }
}

const sizes = Object.fromEntries(
  await Promise.all(
    Object.entries(artifacts).map(async ([name, path]) => [name, await requireNonEmptyFile(path)]),
  ),
)
const executableMachine = await readPeMachine(artifacts.executable)
if (executableMachine !== 0x8664) {
  throw new Error(
    `Expected an x64 unpacked executable (PE machine 0x8664), received 0x${executableMachine.toString(16)}`,
  )
}

stdout.write(
  JSON.stringify(
    {
      verified: true,
      version: packageMetadata.version,
      architecture: 'x64',
      artifacts: Object.fromEntries(
        Object.entries(artifacts).map(([name, path]) => [
          name,
          {
            path: relative(repositoryRoot, path).replaceAll('\\', '/'),
            bytes: sizes[name],
          },
        ]),
      ),
    },
    null,
    2,
  ) + '\n',
)
