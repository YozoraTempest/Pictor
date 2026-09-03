import {
  type ContributionPoint,
  type Disposable,
  type ModuleContext,
  type PictorModule,
  type Token,
} from './module.js'

interface ActiveModule {
  id: string
  disposables: Disposable[]
}

export class ModuleKernel {
  private readonly values = new Map<string, unknown>()
  private readonly contributions = new Map<string, unknown[]>()
  private activeModules: ActiveModule[] = []
  private started = false

  async start(modules: readonly PictorModule[]): Promise<void> {
    if (this.started) throw new Error('Module Kernel has already started')

    const ordered = this.orderModules(modules)
    this.started = true

    try {
      for (const module of ordered) {
        const active: ActiveModule = { id: module.id, disposables: [] }
        this.activeModules.push(active)
        const context = this.createContext(active)
        const dependencies = (module.requires ?? []).map((token) => this.values.get(token.id))
        const value = await module.activate(context, ...dependencies)
        if (module.provides) this.values.set(module.provides.id, value)
      }
    } catch (error) {
      await this.stop()
      throw error
    }
  }

  get<T>(token: Token<T>): T {
    if (!this.values.has(token.id)) throw new Error(`Module capability is unavailable: ${token.id}`)
    return this.values.get(token.id) as T
  }

  has<T>(token: Token<T>): boolean {
    return this.values.has(token.id)
  }

  getContributions<T>(point: ContributionPoint<T>): readonly T[] {
    return (this.contributions.get(point.id) ?? []) as readonly T[]
  }

  async stop(): Promise<void> {
    let firstError: Error | null = null
    for (const active of this.activeModules.toReversed()) {
      for (const disposable of active.disposables.toReversed()) {
        try {
          await disposable.dispose()
        } catch (error) {
          firstError ??= error instanceof Error ? error : new Error(String(error))
        }
      }
    }
    this.activeModules = []
    this.values.clear()
    this.contributions.clear()
    this.started = false
    if (firstError) throw firstError
  }

  private createContext(active: ActiveModule): ModuleContext {
    return {
      contribute: <T>(point: ContributionPoint<T>, value: T): Disposable => {
        const values = this.contributions.get(point.id) ?? []
        values.push(value)
        this.contributions.set(point.id, values)
        const disposable = {
          dispose: () => {
            const index = values.indexOf(value)
            if (index >= 0) values.splice(index, 1)
          },
        }
        active.disposables.push(disposable)
        return disposable
      },
      onDispose: (disposable) => active.disposables.push(disposable),
    }
  }

  private orderModules(modules: readonly PictorModule[]): PictorModule[] {
    const modulesById = new Map<string, PictorModule>()
    const providers = new Map<string, PictorModule>()

    for (const module of modules) {
      if (modulesById.has(module.id)) throw new Error(`Duplicate Module ID: ${module.id}`)
      modulesById.set(module.id, module)
      if (module.provides) {
        const previous = providers.get(module.provides.id)
        if (previous) {
          throw new Error(
            `Duplicate provider for ${module.provides.id}: ${previous.id}, ${module.id}`,
          )
        }
        providers.set(module.provides.id, module)
      }
    }

    const ordered: PictorModule[] = []
    const visiting = new Set<string>()
    const visited = new Set<string>()

    const visit = (module: PictorModule): void => {
      if (visited.has(module.id)) return
      if (visiting.has(module.id)) throw new Error(`Circular Module dependency: ${module.id}`)
      visiting.add(module.id)
      for (const token of module.requires ?? []) {
        const provider = providers.get(token.id)
        if (!provider) throw new Error(`Missing provider for ${token.id}, required by ${module.id}`)
        visit(provider)
      }
      visiting.delete(module.id)
      visited.add(module.id)
      ordered.push(module)
    }

    for (const module of modules) visit(module)
    return ordered
  }
}
