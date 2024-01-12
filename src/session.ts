import {
  Constructor,
  Identified,
  Metadata,
  ParentOf,
  Timing,
  meta,
} from "./common";
import { Ledger, PCT } from "./ledger";
import { ClientMux } from "./client";
import { Agent, AgentOptions } from "./agent";
import { ModelType } from "./models";
import { Message } from "./thread";
import {
  ChatCompletionCreateParams,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from "openai/resources";
import { LoggerFunction } from "./logging";

/**
 * SessionOptions is used to create a new session
 */
export interface SessionOptions {
  /** attach your custom object to the session */
  context?: any;
  /** human readable topic of the session */
  topic?: string;
  /** budget of the session in USD */
  budget?: number;
  /** logger function for FE notifications */
  notifyHandler?: LoggerFunction;
  /** logger function for internal trace messages */
  traceHandler?: LoggerFunction;
}

export type ModelInvocationOptions =
  Partial<ChatCompletionCreateParamsNonStreaming>;

/**
 * Session is the main bus for information exchange between threads and agents.
 * It also tallies the costs and manages the LLM invocations using supplied clients.
 * @param clients the client mux to use for LLM invocations
 * @param options options for the session
 */
export class Session implements Identified, ParentOf<Agent> {
  metadata: Metadata;

  /** Any object that is associated with the session, can be used to pass custom data */
  context: any;

  /** Ledger to keep track of costs and performance */
  private ledger: Ledger;

  /** Budget of the session in USD */
  private budget: number = 1.0;

  /** List of agents that are spawned by this session */
  private agents: Agent[] = [];

  /** ClientMux to use for LLM invocations */
  private clients: ClientMux;

  /** Flag indicating whether the session has been aborted */
  private hasBeenAborted: boolean = false;

  notify: LoggerFunction = (..._stuff: any[]): undefined => {};
  trace: LoggerFunction = (..._stuff: any[]): undefined => {};

  constructor(clients: ClientMux, options: SessionOptions) {
    if (options.notifyHandler) {
      this.notify = options.notifyHandler;
    }
    if (options.traceHandler) {
      this.trace = options.traceHandler;
    }
    this.context = options.context || {};
    this.metadata = meta(Session, options.topic);
    this.ledger = new Ledger(this);
    this.clients = clients;
    this.budget = options.budget || 1.0;
  }

  /** Count agents running within the session at this moment.
   * @returns number of agents
   */
  get agentCount(): number {
    return this.agents.length;
  }

  /** Create an agent within the session.
   * @param constructor constructor of the agent to create
   * @param options options for the agent
   */
  spawnAgent<T extends Agent>(
    constructor: Constructor<T>,
    options?: AgentOptions
  ): T {
    if (this.hasBeenAborted) {
      throw new Error("Session has been aborted");
    }
    const agent = new constructor(this, options);
    this.adopt(agent);
    return agent;
  }

  adopt(child: Agent): void {
    if (child.parent !== this) {
      throw new Error("Agent already has a different parent");
    }
    if (this.agents.includes(child)) {
      throw new Error("Agent already adopted");
    }
    this.agents.push(child);
  }

  abandon(child: Agent): void {
    if (child.parent !== this) {
      throw new Error("Agent has a different parent");
    }
    if (!this.agents.includes(child)) {
      throw new Error("Agent not adopted");
    }
    this.agents = this.agents.filter((t) => t !== child);
  }

  /**
   * Invoke a model with the given messages.
   * Used by agents to invoke LLMs.
   * @param caller object originating the call.
   * @param type model type to use for the call.
   * @param messages messages to send to the model.
   * @returns
   */
  async invokeModel(
    caller: Identified,
    type: ModelType,
    messages: Message[],
    options?: ModelInvocationOptions
  ): Promise<Message> {
    if (this.hasBeenAborted) {
      throw new Error("Session has been aborted");
    }

    if (this.ledger.cost.total >= this.budget) {
      throw new Error("Session budget exceeded");
    }

    const timing = new Timing();

    const invocation: ChatCompletionCreateParams = {
      ...(options ?? {}),
      messages: messages as ChatCompletionMessageParam[],
      model: type,
    };
    const randomID = Math.floor(Math.random() * 1000000);
    //console.log(`[${randomID}] ${caller.metadata.ID} -> ${type}`);
    const response = await this.clients.createChatCompletion(invocation);
    const pct = new PCT({
      prompt: response.usage?.prompt_tokens || 0,
      completion: response.usage?.completion_tokens || 0,
    });
    // console.log(
    //   `[${randomID}] ${caller.metadata.ID} <- ${type} (${pct.prompt}, ${pct.completion}, ${pct.total})`
    // );
    timing.finish();
    this.ledger.add(caller.metadata.ID, type, timing, pct);

    return response.choices[0].message as Message;
  }

  report() {
    return this.ledger.modelCost;
  }

  totalCost() {
    return this.ledger.cost.total;
  }

  getLedger() {
    return this.ledger;
  }

  /** Abort the session.
   * After calling this method, all agents will be notified to abort and the session won't accept new agents or invocations.
   */
  abort() {
    this.metadata.timing.finish();
    this.hasBeenAborted = true;
  }

  get isOverBudget() {
    return this.ledger.cost.total >= this.budget;
  }

  get isAborted() {
    return this.hasBeenAborted;
  }

  agentById(agent: string): Agent | undefined {
    for (const a of this.agents) {
      if (a.metadata.ID === agent) {
        return a;
      }
    }
    return undefined;
  }
}
