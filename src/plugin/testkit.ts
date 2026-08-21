import type { ContributionPoint, Token } from '../kernel/module.js'
import { PluginHost, type PluginDefinition, type PluginStatus } from './host.js'

export class PluginTestHost {
  private readonly host: PluginHost

  constructor(pictorVersion = '0.0.0') {
    this.host = new PluginHost({ pictorVersion })
  }

  start(definitions: readonly PluginDefinition[]): Promise<readonly PluginStatus[]> {
    return this.host.start(definitions)
  }

  get<T>(token: Token<T>): T {
    return this.host.get(token)
  }

  getContributions<T>(point: ContributionPoint<T>): readonly T[] {
    return this.host.getContributions(point)
  }

  stop(): Promise<void> {
    return this.host.stop()
  }
}
