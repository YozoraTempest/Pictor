import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import process, { stdout } from 'node:process'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageMetadata = JSON.parse(await readFile(resolve(repositoryRoot, 'package.json'), 'utf8'))
const lockMetadata = JSON.parse(
  await readFile(resolve(repositoryRoot, 'package-lock.json'), 'utf8'),
)
const releaseNotes = await readFile(resolve(repositoryRoot, 'docs', 'RELEASE_NOTES.md'), 'utf8')
const version = packageMetadata.version

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Invalid release version: ${version}`)
}
if (lockMetadata.version !== version || lockMetadata.packages?.['']?.version !== version) {
  throw new Error('package.json and package-lock.json versions must match')
}

const headingPattern = new RegExp(
  `^## ${version.replaceAll('.', '\\.')} - \\d{4}-\\d{2}-\\d{2}$`,
  'm',
)
const headingMatch = headingPattern.exec(releaseNotes)
if (!headingMatch) {
  throw new Error(`docs/RELEASE_NOTES.md is missing the release heading for ${version}`)
}

const bodyStart = headingMatch.index + headingMatch[0].length
const remaining = releaseNotes.slice(bodyStart).replace(/^\r?\n/, '')
const nextHeading = remaining.search(/^## /m)
const notes = (nextHeading === -1 ? remaining : remaining.slice(0, nextHeading)).trim()
if (!notes) throw new Error(`Release notes for ${version} are empty`)

const tag = `v${version}`
const result = { version, tag }
const outputPath = process.env.GITHUB_OUTPUT

if (outputPath) {
  const notesDirectory = process.env.RUNNER_TEMP || tmpdir()
  const notesPath = resolve(notesDirectory, `pictor-${version}-release-notes.md`)
  await mkdir(dirname(notesPath), { recursive: true })
  await writeFile(notesPath, `${notes}\n`, 'utf8')
  await appendFile(outputPath, `version=${version}\ntag=${tag}\nnotes_path=${notesPath}\n`, 'utf8')
  Object.assign(result, { notesPath })
}

stdout.write(`${JSON.stringify(result)}\n`)
