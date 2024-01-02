import { Agent } from "./agent";
import { Constructor } from "./common";

export class Registry {
  agents: Record<string, Constructor<Agent>> = {};

  constructor() {
    this.agents = {};
  }

  register(id: string, constructor: Constructor<Agent>) {
    this.agents[id] = constructor;
  }

  get(id: string): Constructor<Agent> {
    return this.agents[id];
  }

  has(id: string): boolean {
    return id in this.agents;
  }

  list(): string[] {
    return Object.keys(this.agents);
  }
}
