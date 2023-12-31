import { AgentOptions, BaseAgent } from "../agent";
import { ModelType } from "../models";
import { Session } from "../session";
import { Thread } from "../thread";

export class OneShotAgent<O extends AgentOptions, R> extends BaseAgent<
  O,
  {},
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

  output(answer: string): R {
    throw new Error("Method not implemented.");
  }

  async initialize(options: O): Promise<{}> {
    this.thread.appendUserMessage(this.input());
    return {};
  }

  async step(): Promise<{}> {
    this.thread = await this.advance(this.thread);
    this.stop();
    return {};
  }

  async finalize(): Promise<R> {
    return this.output(this.thread.assistantResponse);
  }
}
