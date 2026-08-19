export interface Disposable {
  dispose(): void | Promise<void>
}

export class Token<T> {
  declare readonly valueType: T

  constructor(readonly id: string) {}
}

export class ContributionPoint<T> {
  declare readonly contributionType: T

  constructor(readonly id: string) {}
}

type TokenValue<TToken> = TToken extends Token<infer TValue> ? TValue : never

type TokenValues<TTokens extends readonly Token<unknown>[]> = {
  [TIndex in keyof TTokens]: TokenValue<TTokens[TIndex]>
}

export interface ModuleContext {
  contribute<T>(point: ContributionPoint<T>, value: T): Disposable
  onDispose(disposable: Disposable): void
}

export interface PictorModule {
  id: string
  requires?: readonly Token<unknown>[]
  provides?: Token<unknown>
  activate(context: ModuleContext, ...dependencies: unknown[]): unknown | Promise<unknown>
}

interface ModuleDefinition<TValue, TRequires extends readonly Token<unknown>[]> {
  id: string
  requires?: TRequires
  provides?: Token<TValue>
  activate(
    context: ModuleContext,
    ...dependencies: TokenValues<TRequires>
  ): TValue | Promise<TValue>
}

export function defineModule<TValue, const TRequires extends readonly Token<unknown>[] = []>(
  definition: ModuleDefinition<TValue, TRequires>,
): PictorModule {
  return definition as PictorModule
}
