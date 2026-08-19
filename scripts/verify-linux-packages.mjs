import { execFile } from 'node:child_process'
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
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
  arch: resolve(outputDirectory, `Pictor-${packageMetadata.version}-arch-x64.pacman`),
  appImage: resolve(outputDirectory, `Pictor-${packageMetadata.version}-linux-x64.AppImage`),
}
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

async function verifyInstalledPayload(root) {
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
    throw new Error('Expected the Pacman desktop entry to launch /opt/Pictor/pictor')
  }
  if (!desktopContent.includes('StartupWMClass=pictor')) {
    throw new Error('Expected the Pacman desktop entry and Electron app_id to use pictor')
  }
  return sizes
}

async function verifyAppImage(temporaryRoot) {
  await requireNonEmptyFile(artifacts.appImage)
  await verifyElfX64(artifacts.appImage)
  await chmod(artifacts.appImage, 0o755)
  const extractionDirectory = resolve(temporaryRoot, 'appimage')
  await mkdir(extractionDirectory, { recursive: true })
  await execute(artifacts.appImage, ['--appimage-extract'], {
    cwd: extractionDirectory,
    maxBuffer: 10 * 1024 * 1024,
  })
  const payload = resolve(extractionDirectory, 'squashfs-root')
  const desktopEntryName = (await readdir(payload)).find((entry) => entry.endsWith('.desktop'))
  if (!desktopEntryName) throw new Error('Expected a desktop entry inside the AppImage')
  const executable = resolve(payload, 'pictor')
  const sizes = {
    appRun: await requireNonEmptyFile(resolve(payload, 'AppRun')),
    executable: await requireNonEmptyFile(executable),
    applicationArchive: await requireNonEmptyFile(resolve(payload, 'resources', 'app.asar')),
    desktopEntry: await requireNonEmptyFile(resolve(payload, desktopEntryName)),
  }
  await verifyElfX64(executable)
  const desktopContent = await readFile(resolve(payload, desktopEntryName), 'utf8')
  if (!desktopContent.includes('StartupWMClass=pictor')) {
    throw new Error('Expected the AppImage desktop entry and Electron app_id to use pictor')
  }
  return sizes
}

const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'pictor-linux-package-'))
try {
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
    arch: await requireNonEmptyFile(artifacts.arch),
    appImage: await requireNonEmptyFile(artifacts.appImage),
  }
  const payloads = {
    arch: await verifyInstalledPayload(archData),
    appImage: await verifyAppImage(temporaryRoot),
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
