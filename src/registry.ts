import { Agent } from "./agent";
import { Constructor } from "./common";

export class Registry {
  agents: Record<string, Constructor<Agent>> = {};

  constructor() {
    this.agents = {};
  }

  register(namespace: string, id: string, constructor: Constructor<Agent>) {
    this.agents[`${namespace}/${id}`] = constructor;
  }

  get(id: string): Constructor<Agent> {
    return this.agents[id];
  }

  has(namespace: string, id: string): boolean {
    return `${namespace}/${id}` in this.agents;
  }

  list(): string[] {
    return Object.keys(this.agents);
  }
}
