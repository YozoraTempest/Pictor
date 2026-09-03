import { z } from 'zod'

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

export const moduleInvocationSchema = z.object({
  moduleId: z.string().min(1),
  method: z.string().min(1),
  input: z.unknown(),
})

export const moduleEventEnvelopeSchema = z.object({
  moduleId: z.string().min(1),
  event: z.string().min(1),
  payload: z.unknown(),
})

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

export class ModuleRouter {
  private readonly registrations = new Map<string, ModuleHandlerRegistration>()

  constructor(registrations: readonly ModuleHandlerRegistration[]) {
    for (const registration of registrations) {
      if (this.registrations.has(registration.contract.id)) {
        throw new Error(`Duplicate Module contract: ${registration.contract.id}`)
      }
      this.registrations.set(registration.contract.id, registration)
    }
  }

  async invoke(moduleId: string, method: string, input: unknown): Promise<unknown> {
    const registration = this.registrations.get(moduleId)
    if (!registration) throw new Error(`Unknown Module contract: ${moduleId}`)
    const methodContract = registration.contract.methods[method]
    const handler = registration.handlers[method]
    if (!methodContract || !handler) throw new Error(`Unknown Module method: ${moduleId}.${method}`)
    const result = await handler(methodContract.input.parse(input))
    return methodContract.output.parse(result)
  }
}
