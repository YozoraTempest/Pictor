import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

import { z } from 'zod'

import { buildChannelSchema, type BuildChannel } from '../shared/app-info.js'

const packageMetadataSchema = z.object({ version: z.string().min(1) })

export const frontendPackageIdentitySchema = z.object({
  version: z.string().min(1),
  buildChannel: buildChannelSchema,
  sourceCommit: z
    .string()
    .regex(/^[0-9a-f]{40}$/)
    .nullable(),
})

export type FrontendPackageIdentity = z.infer<typeof frontendPackageIdentitySchema>

export interface FrontendIdentityOptions {
  readonly version?: string
  readonly projectRoot?: string
  readonly bundledPluginsDirectory?: string
  readonly environment?: Readonly<Record<string, string | undefined>>
}

export interface FrontendIdentity extends FrontendPackageIdentity {
  readonly packageRoot: string
  readonly bundledPluginsDirectory: string
  readonly packaged: boolean
}

export function resolveFrontendIdentity(options: FrontendIdentityOptions = {}): FrontendIdentity {
  const environment = options.environment ?? process.env
  const packaged = environment.PICTOR_PACKAGED === '1'
  const packageRoot = packaged
    ? requiredEnvironment(environment, 'PICTOR_PACKAGE_ROOT')
    : (options.projectRoot ?? environment.PICTOR_PACKAGE_ROOT ?? process.cwd())
  const packageVersion = readPackageVersion(packageRoot)
  const packageIdentity = packaged
    ? readPackageIdentity(resolve(packageRoot, 'out', 'package-identity.json'))
    : null
  const version = options.version ?? packageIdentity?.version ?? packageVersion

  if (packaged && version !== packageVersion) {
    throw new Error(
      `Packaged frontend version ${version} does not match package.json version ${packageVersion}`,
    )
  }
  if (packaged && packageIdentity?.version !== packageVersion) {
    throw new Error(
      `Packaged frontend identity version ${packageIdentity?.version} does not match package.json version ${packageVersion}`,
    )
  }

  const bundledPluginsDirectory = packaged
    ? requiredEnvironment(environment, 'PICTOR_BUNDLED_PLUGINS_DIRECTORY')
    : (options.bundledPluginsDirectory ??
      environment.PICTOR_BUNDLED_PLUGINS_DIRECTORY ??
      resolve(packageRoot, '.pictor', 'bundled-plugins'))

  return {
    packageRoot: resolve(packageRoot),
    bundledPluginsDirectory: resolve(bundledPluginsDirectory),
    version,
    buildChannel: packageIdentity?.buildChannel ?? 'development',
    sourceCommit: packageIdentity?.sourceCommit ?? null,
    packaged,
  }
}

export function assertPackagedNodeFrontend(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): void {
  if (environment.PICTOR_PACKAGED !== '1') return
  const processType = (process as NodeJS.Process & { readonly type?: string }).type
  if (processType === 'browser') {
    throw new Error(
      'Packaged Pictor CLI/TUI requires ELECTRON_RUN_AS_NODE=1; refusing to run as an Electron GUI process',
    )
  }
}

function readPackageVersion(packageRoot: string): string {
  const metadata = packageMetadataSchema.parse(
    readJson(resolve(packageRoot, 'package.json'), 'package.json'),
  )
  return metadata.version
}

function readPackageIdentity(path: string): FrontendPackageIdentity {
  return frontendPackageIdentitySchema.parse(readJson(path, 'package-identity.json'))
}

function readJson(path: string, label: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (cause) {
    throw new Error(`Unable to read packaged ${label}: ${path}`, { cause })
  }
}

function requiredEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = environment[name]
  if (!value) throw new Error(`Packaged Pictor launcher did not provide ${name}`)
  return value
}

export type { BuildChannel }
