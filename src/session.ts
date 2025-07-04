// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: BUSL-1.1

import {
  Constructor,
  Identified,
  Metadata,
  ParentOf,
  Timing,
  meta,
} from "./common";
import { Ledger, LedgerEntry, PCT } from "./ledger";
import { ClientMux } from "./client_mux";
import {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelInvocationOptions,
} from "./clients/common";
import { Agent, AgentOptions } from "./agent";
import { ModelID, ModelMetadata } from "./models";
import { Message } from "./thread";
import { LoggerFunction } from "./logging";
import { EventEmitter } from "events";

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
  /** Function to handle session budget being exceeded */
  sessionBudgetHandler?: SessionBudgetHandler;
}

/**
 * SessionBudgetHandler is called when the session budget is exceeded.
 * 
 * IMPORTANT BEHAVIOR:
 * - This handler will be called AT MOST ONCE per budget exceeded scenario
 * - When multiple operations hit the budget limit simultaneously, they will all wait
 *   for a single budget handler call to complete
 * - After the handler completes, waiting operations check the budget individually:
 *   - If budget is sufficient when they check, they continue
 *   - If budget is still/again exceeded when they check (e.g., user declined increase,
 *     or budget increase was consumed by earlier operations), they fail immediately
 *     with "Session budget exceeded" WITHOUT calling the handler again
 * 
 * @param totalCost - Current total cost of the session
 * @param budget - Current budget limit that was exceeded
 * @param nextMessages - Messages from the operation that triggered this call
 * @param session - The session instance
 * @returns Promise<number> - New budget limit (return same budget to abort all operations)
 */
export type SessionBudgetHandler = (totalCost: number, budget: number, nextMessages: Message[], session: Session) => Promise<number>;

/**
 * SessionReport is a report of the costs of the session
 * and the performance of the models used.
 */
export interface SessionReport {
  /** total cost of the session in USD */
  totalCost: number;
  /** total tokens used in the session */
  totalTokens: number;
  /** total time elapsed in the session in seconds */
  elapsed: number;
  /** cost of each model used in the session */
  cost: Record<ModelID, number>;
  /** tokens used by each model in the session */
  tokens: Record<ModelID, number>;
}

interface AgentListeners {
  start: any;
  stop: any;
  stopping: any;
  step: any;
  heartbeat: any;
}

/** Session events */
export interface SessionEvents<StateType, ResultType> {
  "agent-start": (agent: string, state: StateType) => void;
  "agent-stop": (agent: string, result: ResultType) => void;
  "agent-stopping": (agent: string, state: StateType) => void;
  "agent-step": (agent: string, state: StateType) => void;
  "ledger-entry": (entry: LedgerEntry) => void;
  heartbeat: () => void;
}

export interface Session {
  on<U extends keyof SessionEvents<any, any>>(
    event: U,
    listener: SessionEvents<any, any>[U]
  ): this;
  emit<U extends keyof SessionEvents<any, any>>(
    event: U,
    ...args: Parameters<SessionEvents<any, any>[U]>
  ): boolean;
  off<U extends keyof SessionEvents<any, any>>(
    event: U,
    listener: SessionEvents<any, any>[U]
  ): this;
  once<U extends keyof SessionEvents<any, any>>(
    event: U,
    listener: SessionEvents<any, any>[U]
  ): this;
}

/**
 * Session is the main bus for information exchange between threads and agents.
 * It also tallies the costs and manages the LLM invocations using supplied clients.
 * @param clients the client mux to use for LLM invocations
 * @param options options for the session
 */
export class Session
  extends EventEmitter
  implements Identified, ParentOf<Agent>
{
  metadata: Metadata;

  /** Any object that is associated with the session, can be used to pass custom data */
  context: any;

  /** Ledger to keep track of costs and performance */
  private ledger: Ledger;

  /** Budget of the session in USD */
  private budget: number = 1.0;

  /** List of agents that are spawned by this session */
  private agents: Agent[] = [];

  /** Agent event listeners */
  private agentListeners: Record<string, AgentListeners> = {};

  /** Ledger event listener */
  private ledgerListener: any;

  /** ClientMux to use for LLM invocations */
  #clients: ClientMux;

  /** Flag indicating whether the session has been aborted */
  private hasBeenAborted: boolean = false;

  /** Promise tracking current budget handler execution to prevent concurrent calls */
  private budgetHandlerPromise: Promise<void> | null = null;

  notify: LoggerFunction = (..._stuff: any[]): undefined => {};
  trace: LoggerFunction = (..._stuff: any[]): undefined => {};
  sessionBudgetHandler?: SessionBudgetHandler;

  constructor(clients: ClientMux, options: SessionOptions) {
    super();
    if (options.notifyHandler) {
      this.notify = options.notifyHandler;
    }
    if (options.traceHandler) {
      this.trace = options.traceHandler;
    }
    this.sessionBudgetHandler = options.sessionBudgetHandler;
    this.context = options.context || {};
    this.metadata = meta(Session, options.topic);
    this.ledger = new Ledger(this);
    this.ledgerListener = (entry: any) => {
      this.emit("ledger-entry", entry);
    };
    this.ledger.on("entry", this.ledgerListener);
    this.#clients = clients;
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
    this.setUpListeners(child);
    this.agents.push(child);
  }

  private setUpListeners(child: Agent): void {
    const listeners: AgentListeners = {
      start: (state: any) => {
        this.emit("agent-start", child.metadata.ID, state);
      },
      stop: (result: any) => {
        this.emit("agent-stop", child.metadata.ID, result);
      },
      stopping: (state: any) => {
        this.emit("agent-stopping", child.metadata.ID, state);
      },
      step: (state: any) => {
        this.emit("agent-step", child.metadata.ID, state);
      },
      heartbeat: () => {
        this.emit("heartbeat");
      },
    };
    Object.entries(listeners).forEach(([event, listener]) => {
      child.on(event as keyof AgentListeners, listener);
    });
    this.agentListeners[child.metadata.ID] = listeners;
  }

  abandon(child: Agent): void {
    if (child.parent !== this) {
      throw new Error("Agent has a different parent");
    }
    if (!this.agents.includes(child)) {
      throw new Error("Agent not adopted");
    }
    this.clearListeners(child);
    this.agents = this.agents.filter((t) => t !== child);
  }

  private clearListeners(child: Agent): void {
    const listeners = this.agentListeners[child.metadata.ID];
    Object.entries(listeners).forEach(([event, listener]) => {
      child.off(event as keyof AgentListeners, listener);
    });
    delete this.agentListeners[child.metadata.ID];
  }

  /**
   * Check budget and handle budget exceeded scenario with proper synchronization.
   * Only one budget handler can execute at a time. Subsequent calls wait for the current one to complete.
   * If budget is still exceeded after waiting, those calls fail immediately without calling the handler again.
   * @param messages the messages to be sent to the model
   */
  private async checkBudgetAndHandle(messages: Message[]): Promise<void> {
    // If budget is not exceeded, return immediately
    if (this.ledger.cost.total < this.budget) {
      return;
    }

    // If no budget handler is configured, throw error immediately
    if (!this.sessionBudgetHandler) {
      throw new Error("Session budget exceeded");
    }

    // If there's already a budget handler running, wait for it to complete
    if (this.budgetHandlerPromise) {
      await this.budgetHandlerPromise;
      // After waiting, re-check if budget is now sufficient
      if (this.ledger.cost.total < this.budget) {
        return;
      }
      // If still over budget, fail immediately without calling handler again
      throw new Error("Session budget exceeded");
    }

    // Create and track the budget handler promise
    this.budgetHandlerPromise = this.executeBudgetHandler(messages);
    
    try {
      await this.budgetHandlerPromise;
    } finally {
      this.budgetHandlerPromise = null;
    }

    // Final check: if budget is still exceeded after handler, throw error
    if (this.ledger.cost.total > this.budget) {
      throw new Error("Session budget exceeded");
    }
  }

  /**
   * Execute the budget handler with the given messages.
   * @param messages the messages to be sent to the model
   */
  private async executeBudgetHandler(messages: Message[]): Promise<void> {
    if (!this.sessionBudgetHandler) {
      return;
    }

    this.budget = await this.sessionBudgetHandler(
      this.ledger.cost.total,
      this.budget,
      messages,
      this
    );
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
    model: ModelMetadata,
    messages: Message[],
    options?: ModelInvocationOptions
  ): Promise<Message> {
    if (this.hasBeenAborted) {
      throw new Error("Session has been aborted");
    }

    // Check budget with proper synchronization to prevent concurrent budget handler calls
    await this.checkBudgetAndHandle(messages);

    const timing = new Timing();

    const invocation: ChatCompletionRequest = {
      options: options,
      messages: messages,
      model: model.id,
    };

    // ensure client for model is available
    try {
      await this.#clients.ensureClient(model);
    } catch (err) {
      console.error("Error ensuring client for model", model, err);
      throw err;
    }

    const response: ChatCompletionResponse =
      await this.#clients.createChatCompletion(invocation);
    const pct = new PCT({
      prompt: response.usage?.prompt_tokens || 0,
      completion: response.usage?.completion_tokens || 0,
    });
    timing.finish();
    this.ledger.add(caller.metadata.ID, model, timing, pct);

    return response.messages[0];
  }

  report(): SessionReport {
    const report = {
      totalCost: this.totalCost(),
      totalTokens: this.totalTokens(),
      elapsed: this.metadata.timing.elapsed.asSeconds(),
      cost: {} as Record<ModelID, number>,
      tokens: {} as Record<ModelID, number>,
    };
    for (const [model, cost] of Object.entries(this.ledger.modelCost)) {
      if (cost.total > 0) {
        report.cost[model as ModelID] = cost.total;
      }
    }
    for (const [model, tokens] of Object.entries(this.ledger.modelTokens)) {
      if (tokens.total > 0) {
        report.tokens[model as ModelID] = tokens.total;
      }
    }
    return report;
  }

  totalCost() {
    return this.ledger.cost.total;
  }

  totalTokens() {
    return this.ledger.tokens.total;
  }

  getLedger() {
    return this.ledger;
  }

  /** Abort the session.
   * After calling this method, all agents will be notified to abort and the session won't accept new agents or invocations.
   */
  abort() {
    this.metadata.timing.finish();
    this.ledger.off("entry", this.ledgerListener);
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
