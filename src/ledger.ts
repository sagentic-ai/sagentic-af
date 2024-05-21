// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: MIT

import { ID, Timing } from "./common";
import { ModelType, pricing } from "./models";
import moment from "moment";
import { Session } from "./session";
import { EventEmitter } from "events";

/** PCT stands for prompt, completion and total quantities */
export class PCT {
  prompt: number;
  completion: number;
  _total: number;

  get total(): number {
    return this._total;
  }

  /** Create a new PCT, zeroed by default if no data is provided.
   * If data is provided, total will be computed by adding prompt and completion quantities.
   * @param data optional object with prompt and completion quantities
   */
  constructor(data?: { prompt: number; completion: number }) {
    if (data) {
      this.prompt = data.prompt;
      this.completion = data.completion;
      this._total = data.prompt + data.completion;
    } else {
      this.prompt = 0;
      this.completion = 0;
      this._total = 0;
    }
  }

  /** Add another PCT to this one, mutates receiver.
   * @param other PCT to add to this one
   */
  add(other: PCT): PCT {
    this.prompt += other.prompt;
    this.completion += other.completion;
    this._total += other.total;
    return this;
  }
}

/** LedgerEntry represents a single LLM invocation */
export interface LedgerEntry {
  callerID: ID;
  timing: Timing;
  model: ModelType;
  tokens: PCT;
  cost: PCT;
}

/** Events emitted by the Ledger */
export interface LedgerEvents {
  entry: (entry: LedgerEntry) => void;
}

export interface Ledger {
  on<U extends keyof LedgerEvents>(event: U, listener: LedgerEvents[U]): this;
  emit<U extends keyof LedgerEvents>(
    event: U,
    ...args: Parameters<LedgerEvents[U]>
  ): boolean;
  off<U extends keyof LedgerEvents>(event: U, listener: LedgerEvents[U]): this;
  once<U extends keyof LedgerEvents>(event: U, listener: LedgerEvents[U]): this;
}

/** Ledger tracks LLM invocations and associated token counts and costs */
export class Ledger extends EventEmitter {
  private session: Session;
  private log: LedgerEntry[];

  private totalTokens: PCT;
  private tokensPerModel: Record<ModelType, PCT>;
  private tokensPerCaller: Record<ID, PCT>;

  private totalCost: PCT;
  private costPerModel: Record<ModelType, PCT>;
  private costPerCaller: Record<ID, PCT>;

  /** Create a new Ledger for the given session
   * @param session the session that the ledger is associated with
   */
  constructor(session: Session) {
    super();
    this.session = session;
    this.log = [];

    this.totalTokens = new PCT();
    this.totalCost = new PCT();

    this.costPerModel = {} as Record<ModelType, PCT>;
    this.tokensPerModel = {} as Record<ModelType, PCT>;
    for (const model of Object.values(ModelType)) {
      this.costPerModel[model] = new PCT();
      this.tokensPerModel[model] = new PCT();
    }

    this.costPerCaller = {} as Record<ID, PCT>;
    this.tokensPerCaller = {} as Record<ID, PCT>;
  }

  /** Add a new entry to the ledger
   * @param callerID the ID of the entity that invoked the LLM
   * @param model the model that was invoked
   * @param timing the timing information as reported by the LLM
   * @param tokens the number of tokens used as reported by the LLM
   */
  add(callerID: ID, model: ModelType, timing: Timing, tokens: PCT): void {
    if (!timing.hasEnded) throw new Error("Timing has not ended");

    this.totalTokens.add(tokens);
    this.tokensPerModel[model].add(tokens);

    const cost: PCT = new PCT({
      prompt: (tokens.prompt / 1000000.0) * pricing[model].prompt,
      completion: (tokens.completion / 1000000.0) * pricing[model].completion,
    });

    this.totalCost.add(cost);
    this.costPerModel[model].add(cost);

    if (!this.tokensPerCaller[callerID]) {
      this.tokensPerCaller[callerID] = new PCT();
    }
    this.tokensPerCaller[callerID].add(tokens);

    if (!this.costPerCaller[callerID]) {
      this.costPerCaller[callerID] = new PCT();
    }
    this.costPerCaller[callerID].add(cost);

    const entry = {
      callerID: callerID,
      timing: timing,
      model: model,
      tokens: tokens,
      cost: cost,
    };

    this.log.push(entry);
    this.emit("entry", entry);
  }

  /** Return the timespan covered by the ledger entries */
  get timespan(): moment.Duration {
    if (this.len === 0) return moment.duration(0);
    let start: moment.Moment = this.log[0].timing.start;
    let end: moment.Moment = this.log[0].timing.end!;
    for (const entry of this.log) {
      if (entry.timing.start.isBefore(start)) {
        start = entry.timing.start;
      }
      if (entry.timing.end && entry.timing.end.isAfter(end)) {
        end = entry.timing.end;
      }
    }
    return moment.duration(end.diff(start));
  }

  /** Return the total number of ledger entries*/
  get len(): number {
    return this.log.length;
  }

  /** Return the total cost*/
  get cost(): PCT {
    return this.totalCost;
  }

  /** Return the total number of tokens used */
  get tokens(): PCT {
    return this.totalTokens;
  }

  /** Return the total cost per model */
  get modelCost(): Record<ModelType, PCT> {
    return this.costPerModel;
  }

  /** Return the total number of tokens used per model */
  get modelTokens(): Record<ModelType, PCT> {
    return this.tokensPerModel;
  }

  /** Return the total number of tokens used per caller */
  get callerTokens(): Record<ID, PCT> {
    return this.tokensPerCaller;
  }

  /** Return the total cost per caller */
  get callerCost(): Record<ID, PCT> {
    return this.costPerCaller;
  }

  get entries(): LedgerEntry[] {
    return this.log;
  }
}
