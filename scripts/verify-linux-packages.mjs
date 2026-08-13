import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, relative, resolve } from 'node:path'
import { stdout } from 'node:process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execute = promisify(execFile)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageMetadata = JSON.parse(await readFile(resolve(repositoryRoot, 'package.json'), 'utf8'))
const outputDirectory = resolve(repositoryRoot, 'dist')
const artifacts = {
  ubuntu: resolve(outputDirectory, `Pictor-${packageMetadata.version}-ubuntu-x64.deb`),
  arch: resolve(outputDirectory, `Pictor-${packageMetadata.version}-arch-x64.pacman`),
}
const expectedUbuntuDependencies = [
  'libatspi2.0-0t64',
  'libgtk-3-0t64',
  'libnotify4',
  'libnss3',
  'libsecret-1-0',
  'libuuid1',
  'libxss1',
  'libxtst6',
  'xdg-utils',
]
const expectedArchDependencies = [
  'alsa-lib',
  'at-spi2-core',
  'cairo',
  'dbus',
  'expat',
  'glib2',
  'glibc',
  'gtk3',
  'libcups',
  'libgcc',
  'libsecret',
  'libx11',
  'libxcb',
  'libxcomposite',
  'libxdamage',
  'libxext',
  'libxfixes',
  'libxkbcommon',
  'libxrandr',
  'mesa',
  'nspr',
  'nss',
  'pango',
  'systemd-libs',
  'xdg-utils',
]

async function requireNonEmptyFile(path) {
  const metadata = await stat(path)
  if (!metadata.isFile() || metadata.size === 0) {
    throw new Error(`Expected a non-empty file: ${relative(repositoryRoot, path)}`)
  }
  return metadata.size
}

async function extract(path, destination) {
  await mkdir(destination, { recursive: true })
  await execute('bsdtar', ['-xf', path, '-C', destination])
}

async function findArchive(directory, prefix) {
  const entries = await readdir(directory)
  const name = entries.find((entry) => entry.startsWith(prefix))
  if (!name) throw new Error(`Expected ${prefix} archive in ${directory}`)
  return resolve(directory, name)
}

function parseMetadataEntries(content) {
  return content
    .split(/\r?\n/)
    .map((line) => line.split(/:\s*|\s*=\s*/, 2))
    .filter((entry) => entry.length === 2)
}

function parseMetadata(content) {
  return new Map(parseMetadataEntries(content))
}

async function verifyElfX64(path) {
  const header = (await readFile(path)).subarray(0, 20)
  if (header.length < 20 || header.toString('ascii', 0, 4) !== '\u007fELF') {
    throw new Error(`Expected an ELF executable: ${path}`)
  }
  if (header[4] !== 2 || header[5] !== 1 || header.readUInt16LE(18) !== 0x3e) {
    throw new Error(`Expected a little-endian x86-64 ELF executable: ${path}`)
  }
}

async function verifyPayload(root) {
  const executable = resolve(root, 'opt', 'Pictor', 'pictor')
  const applicationArchive = resolve(root, 'opt', 'Pictor', 'resources', 'app.asar')
  const desktopEntry = resolve(root, 'usr', 'share', 'applications', 'pictor.desktop')
  const sizes = {
    executable: await requireNonEmptyFile(executable),
    applicationArchive: await requireNonEmptyFile(applicationArchive),
    desktopEntry: await requireNonEmptyFile(desktopEntry),
  }
  await verifyElfX64(executable)
  const desktopContent = await readFile(desktopEntry, 'utf8')
  if (!desktopContent.includes('Exec=/opt/Pictor/pictor %U')) {
    throw new Error('Expected the Linux desktop entry to launch /opt/Pictor/pictor')
  }
  if (!desktopContent.includes('StartupWMClass=pictor')) {
    throw new Error('Expected the Linux desktop entry and Electron app_id to use pictor')
  }
  return sizes
}

const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'pictor-linux-package-'))
try {
  const ubuntuArchive = resolve(temporaryRoot, 'ubuntu-archive')
  await extract(artifacts.ubuntu, ubuntuArchive)
  const ubuntuData = resolve(temporaryRoot, 'ubuntu-data')
  const ubuntuControl = resolve(temporaryRoot, 'ubuntu-control')
  await extract(await findArchive(ubuntuArchive, 'data.tar'), ubuntuData)
  await extract(await findArchive(ubuntuArchive, 'control.tar'), ubuntuControl)
  const debianControl = parseMetadata(await readFile(resolve(ubuntuControl, 'control'), 'utf8'))
  if (debianControl.get('Architecture') !== 'amd64') {
    throw new Error(
      `Expected Debian architecture amd64, received ${debianControl.get('Architecture')}`,
    )
  }
  if (
    debianControl.get('Package') !== packageMetadata.name ||
    debianControl.get('Version') !== packageMetadata.version
  ) {
    throw new Error('Debian package name or version does not match package.json')
  }
  const ubuntuDependencies = (debianControl.get('Depends') ?? '')
    .split(',')
    .map((dependency) => dependency.trim())
    .filter(Boolean)
    .toSorted()
  if (JSON.stringify(ubuntuDependencies) !== JSON.stringify(expectedUbuntuDependencies)) {
    throw new Error(
      `Debian dependencies do not match the Ubuntu 24.04 baseline: ${ubuntuDependencies.join(', ')}`,
    )
  }
  if (debianControl.has('Recommends')) {
    throw new Error('Debian package must not recommend unrelated desktop indicator packages')
  }

  const archData = resolve(temporaryRoot, 'arch-data')
  await extract(artifacts.arch, archData)
  const packageInfoContent = await readFile(resolve(archData, '.PKGINFO'), 'utf8')
  const packageInfo = parseMetadata(packageInfoContent)
  if (packageInfo.get('arch') !== 'x86_64') {
    throw new Error(`Expected Pacman architecture x86_64, received ${packageInfo.get('arch')}`)
  }
  if (
    packageInfo.get('pkgname') !== packageMetadata.name ||
    packageInfo.get('pkgver') !== `${packageMetadata.version}-1`
  ) {
    throw new Error('Pacman package name, application version, or package release is invalid')
  }
  const archDependencies = parseMetadataEntries(packageInfoContent)
    .filter(([key]) => key === 'depend')
    .map(([, value]) => value)
    .toSorted()
  if (JSON.stringify(archDependencies) !== JSON.stringify(expectedArchDependencies)) {
    throw new Error(
      `Pacman dependencies do not match the Arch baseline: ${archDependencies.join(', ')}`,
    )
  }

  const packageSizes = {
    ubuntu: await requireNonEmptyFile(artifacts.ubuntu),
    arch: await requireNonEmptyFile(artifacts.arch),
  }
  const payloads = {
    ubuntu: await verifyPayload(ubuntuData),
    arch: await verifyPayload(archData),
  }
  stdout.write(
    `${JSON.stringify(
      {
        verified: true,
        version: packageMetadata.version,
        architecture: 'x64',
        packages: Object.fromEntries(
          Object.entries(artifacts).map(([name, path]) => [
            name,
            {
              path: relative(repositoryRoot, path).replaceAll('\\', '/'),
              bytes: packageSizes[name],
            },
          ]),
        ),
        payloads,
      },
      null,
      2,
    )}\n`,
  )
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
