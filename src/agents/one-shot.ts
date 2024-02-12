// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: MIT

import { AgentOptions, BaseAgent } from "../agent";
import { ModelType } from "../models";
import { Session } from "../session";
import { Thread } from "../thread";

export class OneShotAgent<
  OptionsType extends AgentOptions,
  ResultType,
> extends BaseAgent<OptionsType, void, ResultType> {
  model: ModelType = ModelType.GPT35Turbo;
  thread: Thread;

  constructor(session: Session, options: OptionsType) {
    super(session, options);
    this.thread = this.createThread();
  }

  async input(): Promise<string> {
    throw new Error("Method not implemented.");
  }

  async output(_answer: string): Promise<ResultType> {
    throw new Error("Method not implemented.");
  }

  async initialize(_options: OptionsType): Promise<void> {
    this.thread.appendUserMessage(await this.input());
  }

  async step(): Promise<void> {
    this.thread = await this.advance(this.thread);
    this.stop();
  }

  async finalize(): Promise<ResultType> {
    return this.output(this.thread.assistantResponse);
  }
}
