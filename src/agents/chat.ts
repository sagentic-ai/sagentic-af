import { BaseAgent, AgentOptions } from "../agent";
import { Session } from "../session";
import { Thread } from "../thread";

export class ChatAgent<OptionsType extends AgentOptions> extends BaseAgent<
  OptionsType,
  void,
  void
> {
  thread: Thread;
  resolveReply?: (message: string) => void;
  msgPromise: Promise<void>;
  msgPromiseResolve?: () => void;

  constructor(session: Session, options: OptionsType) {
    super(session, options);
    this.thread = this.createThread();
    this.msgPromise = new Promise<void>((resolve) => {
      this.msgPromiseResolve = resolve;
    });
  }

  async finalize(state: void): Promise<void> {
    throw new Error("Should never be called");
  }

  async sendMessage(message: string): Promise<string> {
    const response = new Promise<string>((resolve) => {
      this.resolveReply = resolve;
    });
    this.abandon(this.thread);
    this.thread = this.thread.appendUserMessage(message);
    this.adopt(this.thread);

    if (this.msgPromiseResolve) {
      this.msgPromiseResolve();
    }
    this.msgPromise = new Promise<void>((resolve) => {
      this.msgPromiseResolve = resolve;
    });

    const res = await response;
    return res;
  }

  private async sendResponse(message: string): Promise<void> {
    if (this.resolveReply) {
      this.resolveReply(message);
      this.resolveReply = undefined;
    } else {
      throw new Error("No resolveReply");
    }
  }

  async step(state: void): Promise<void> {
    if (this.thread.complete) {
      await this.msgPromise;
    }
    this.thread = await this.advance(this.thread);
    const lastMessage = this.thread.assistantResponse;
    await this.sendResponse(lastMessage);
  }
}
