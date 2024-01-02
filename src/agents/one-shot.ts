import { AgentOptions, BaseAgent } from "../agent";
import { ModelType } from "../models";
import { Session } from "../session";
import { Thread } from "../thread";

export class OneShotAgent<O extends AgentOptions, R> extends BaseAgent<
  O,
  void,
  R
> {
  model: ModelType = ModelType.GPT35Turbo;
  thread: Thread;

  constructor(session: Session, options: O) {
    super(session, options);
    this.thread = this.createThread();
  }

  input(): string {
    throw new Error("Method not implemented.");
  }

  output(_answer: string): R {
    throw new Error("Method not implemented.");
  }

  async initialize(_options: O): Promise<void> {
    this.thread.appendUserMessage(this.input());
  }

  async step(): Promise<void> {
    this.thread = await this.advance(this.thread);
    this.stop();
  }

  async finalize(): Promise<R> {
    return this.output(this.thread.assistantResponse);
  }
}
