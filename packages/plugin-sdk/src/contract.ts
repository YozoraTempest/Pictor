import type { z } from 'zod'

import { ContributionPoint } from './module.js'

interface MethodContract {
  input: z.ZodType
  output: z.ZodType
}

interface EventContract {
  payload: z.ZodType
}

export interface ModuleContract<
  TMethods extends Record<string, MethodContract> = Record<string, MethodContract>,
  TEvents extends Record<string, EventContract> = Record<string, EventContract>,
> {
  id: string
  methods: TMethods
  events: TEvents
}

export function defineModuleContract<
  const TMethods extends Record<string, MethodContract>,
  const TEvents extends Record<string, EventContract> = Record<never, never>,
>(contract: ModuleContract<TMethods, TEvents>): ModuleContract<TMethods, TEvents> {
  return contract
}

type MethodInput<TMethod extends MethodContract> = z.input<TMethod['input']>
type MethodHandlerInput<TMethod extends MethodContract> = z.output<TMethod['input']>
type MethodOutput<TMethod extends MethodContract> = z.output<TMethod['output']>

export type ModuleHandlers<TContract extends ModuleContract> = {
  [TMethod in keyof TContract['methods']]: (
    input: MethodHandlerInput<TContract['methods'][TMethod]>,
  ) =>
    | MethodOutput<TContract['methods'][TMethod]>
    | Promise<MethodOutput<TContract['methods'][TMethod]>>
}

export interface ModuleHandlerRegistration {
  contract: ModuleContract
  handlers: Record<string, (input: unknown) => unknown | Promise<unknown>>
}

export function registerModuleHandlers<TContract extends ModuleContract>(
  contract: TContract,
  handlers: ModuleHandlers<TContract>,
): ModuleHandlerRegistration {
  return { contract, handlers } as ModuleHandlerRegistration
}

export const moduleHandlerContributions = new ContributionPoint<ModuleHandlerRegistration>(
  'kernel.module-handlers',
)

export interface ModuleTransport {
  invoke(moduleId: string, method: string, input: unknown): Promise<unknown>
  onEvent(moduleId: string, event: string, listener: (payload: unknown) => void): () => void
}

export async function invokeModuleMethod<
  TContract extends ModuleContract,
  TMethod extends keyof TContract['methods'] & string,
>(
  transport: ModuleTransport,
  contract: TContract,
  method: TMethod,
  input: MethodInput<TContract['methods'][TMethod]>,
): Promise<MethodOutput<TContract['methods'][TMethod]>> {
  const methodContract = contract.methods[method] as TContract['methods'][TMethod]
  const parsedInput = methodContract.input.parse(input)
  const output = await transport.invoke(contract.id, method, parsedInput)
  return methodContract.output.parse(output) as MethodOutput<TContract['methods'][TMethod]>
}
