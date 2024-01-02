import { Agent } from "./agent";
import { ChildOf, Conclusible, Identified, Metadata, meta } from "./common";

/** Role of a message */
export enum MessageRole {
  /** System prompt, only allowed once in a conversation, in the beginning */
  System = "system",
  /** Prompt sent by user i.e. going from us to OpenAI */
  User = "user",
  /** Prompt sent by assistant i.e. going from OpenAI to us */
  Assistant = "assistant",
  /** Tool response */
  Tool = "tool",
}

/** Message sent in a conversation */
export interface Message {
  role: MessageRole;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

/** ToolResult is a result of a tool call */
export interface ToolResult {
  /** ID of the tool call */
  toolCallID: string;
  /** Result of the tool call */
  result: string;
}

/** ToolCall is a call to a tool */
export interface ToolCall {
  /** ID of the tool call */
  id: string;
  /** Tool type to call */
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

/** Used to determine whether we have a text message or something else*/
export const isText = (o: any): o is string => typeof o === "string";

/** Interaction is a single interaction in a conversation.
 * An interaction is a pair of messages, one from us to OpenAI and one from OpenAI to us.
 * The messages can be either text or tool calls or responses to tool calls.
 * Interactions are chained together to form a thread in a form of linked list.
 * An Interaction can be complete or incomplete.
 * An interaction is complete if we have received a response from OpenAI completing the interaction.
 * This means that if the last message in the interaction is from us, the interaction is not complete.
 */
export class Interaction {
  /** Previous interaction in chain */
  previous?: Interaction;
  /** Text sent (or to be sent) by us to OpenAI */
  user: string | ToolResult[];
  /** Text received from OpenAI */
  assistant?: string | ToolCall[];

  /** Create new Interaction
   * @param user Text or tool results sent (or to be sent) by us to OpenAI
   * @param previous Previous interaction in chain, omitting this means this is the first interaction in the chain
   * @returns Interaction
   */
  constructor(user: string | ToolResult[], previous?: Interaction) {
    if (previous && !previous.complete) {
      throw new Error("Cannot create interaction with incomplete previous");
    }
    this.previous = previous;
    this.user = user;
    this.assistant = undefined;
  }

  /** Is this interaction complete?
   * An interaction is complete if we have received a response from OpenAI.
   * @returns true if complete, false otherwise
   */
  get complete(): boolean {
    return this.assistant !== undefined;
  }

  /** Does this interaction expect response from tools?
   * @returns true if expects response from tools, false otherwise
   * @throws Error if malformed tool call
   */
  get expectsToolResponse(): boolean {
    return (
      this.complete && this.assistant !== undefined && !isText(this.assistant)
    );
  }

  /** Convert interaction chain ending in this interaction to array of messages
   * @returns Array of messages
   */
  toMessages(): Message[] {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let current: Interaction | undefined = this;
    const ret: Message[] = [];
    while (current) {
      if (current.complete) {
        if (current.assistant && isText(current.assistant)) {
          // if we have a string response from agent then just put it in a message
          ret.unshift({
            role: MessageRole.Assistant,
            content: current.assistant! as string,
          });
        } else {
          // if we have a tool call then pack it in a message
          ret.unshift({
            role: MessageRole.Assistant,
            content: null,
            tool_calls: current.assistant! as ToolCall[],
          });
        }
      }
      if (current.user && isText(current.user)) {
        // if we have a string prompt from user then just put it in a message
        ret.unshift({
          role: MessageRole.User,
          content: current.user as string,
        });
      } else {
        // if we have a tool result then unpack it into messages
        const toolResults = current.user as ToolResult[];
        for (let i = toolResults.length - 1; i >= 0; i--) {
          ret.unshift({
            role: MessageRole.Tool,
            content: toolResults[i].result,
            tool_call_id: toolResults[i].toolCallID,
          });
        }
      }
      current = current.previous;
    }
    return ret;
  }
}

/** Thread is a single thread of conversation.
 * In practice Thread just points to the last interaction in the thread.
 * Threads are only partially mutable, meaning that appending messages to a
 * thread creates a new thread if the last interaction tn the thread is complete.
 */
export class Thread implements Identified, Conclusible, ChildOf<Agent> {
  /** Metadata for this thread */
  metadata: Metadata;

  /** last interaction in this thread */
  interaction: Interaction;

  /** Agent owning this thread */
  get parent(): Agent {
    if (!this.metadata.parent) {
      throw new Error("Thread does not have an owner");
    }
    return this.metadata.parent! as Agent;
  }

  /** Create new thread.
   * @param owner Agent owning this thread
   * @returns Thread
   */
  constructor(parent: Agent, topic?: string) {
    this.metadata = meta(Thread, topic);
    this.metadata.parent = parent;
    this.interaction = new Interaction("");
  }

  /** Get messages in this thread.
   * This includes system prompt from the owning agent if present.
   * @returns Array of messages
   */
  get messages(): Message[] {
    const m = this.interaction.toMessages();
    if (this.parent.systemPrompt)
      m.unshift({
        role: MessageRole.System,
        content: this.parent.systemPrompt,
      });
    return m;
  }

  /** Is this thread complete?
   * A thread is complete if the last interaction is complete.
   * In practice this means that if the last message in the thread is from us, the thread is not complete.
   * If the last message in the thread is from OpenAI, the thread is complete.
   * Completing a thread is done by appending a message from assistant to it.
   * @returns true if complete, false otherwise
   */
  get complete(): boolean {
    return this.interaction.complete;
  }

  get empty(): boolean {
    return this.interaction.user.length === 0;
  }

  /** Is this thread suitable to be sent to the LLM? */
  get isSendable(): boolean {
    return !this.complete && !this.empty;
  }

  /** Does this thread want a tool response? */
  get expectsToolResponse(): boolean {
    return this.interaction.expectsToolResponse;
  }

  /** Append a user message to this thread.
   * Beware: this method mutates the thread when it's incomplete. Always use the return value.
   * It is always legal to append user message.
   * In case the thread is complete, a new thread is created with the message appended.
   * In case the thread is incomplete, the message is appended to the last user message in the thread.
   * @param message Message to append
   * @returns new Thread object with the message appended
   * @throws Error if the thread does not end in user text prompt or if the thread is complete and expects tool response
   */
  appendUserMessage(message: string): Thread {
    if (!this.complete) {
      if (!isText(this.interaction.user)) {
        throw new Error(
          "Cannot append user message to tool result interaction"
        );
      }
      this.interaction.user += message;
      return this;
    } else {
      if (this.interaction.expectsToolResponse) {
        throw new Error(
          "Cannot append user message to interaction that expects tool response"
        );
      }
      const newInteraction = new Interaction(message, this.interaction);
      const newThread = new Thread(this.parent);
      newThread.interaction = newInteraction;
      return newThread;
    }
  }

  /** Append a tool result to this thread.
   * Beware: this method mutates the thread when it's incomplete. Always use the return value.
   * It is only legal if the thread is complete and the last message in the thread is a tool call.
   * @param toolCallID ID of the tool call
   * @param result Result of the tool call
   * @returns new Thread object with the tool result appended
   * @throws Error if the the thread does not end with a tool call
   */
  appendToolResult(toolCallID: string, result: string): Thread {
    if (!this.complete) {
      if (isText(this.interaction.user)) {
        throw new Error("Cannot append tool result text prompt interaction");
      }
      this.interaction.user.push({ toolCallID, result });
      return this;
    } else {
      if (!this.interaction.expectsToolResponse) {
        throw new Error(
          "Cannot append tool result to interaction that does not expect tool response"
        );
      }
      const newInteraction = new Interaction(
        [{ toolCallID, result }] as ToolResult[],
        this.interaction
      );
      const newThread = new Thread(this.parent);
      newThread.interaction = newInteraction;
      return newThread;
    }
  }

  /** Append an assistant message to this thread.
   * Beware: this method mutates the thread when it's incomplete. Always use the return value.
   * It is only legal to append assistant message if the thread is not complete.
   * @throws Error if the thread is complete
   * @param message Message to append
   * @returns new Thread object with the message appended
   */
  appendAssistantMessage(message: string): Thread {
    if (!this.complete && !this.empty) {
      this.interaction.assistant = message;
      return this;
    } else {
      throw new Error("Cannot append to complete interaction");
    }
  }

  /** Append a tool calls to this thread.
   * It is only legal to append tool call if the thread is not complete.
   * @throws Error if the thread is complete
   * @param toolCalls Tool calls to append
   * @returns new Thread object with the tool call appended
   */
  appendAssistantToolCalls(toolCalls: ToolCall[]): Thread {
    if (toolCalls.length === 0) {
      throw new Error("Cannot append empty tool call");
    }
    if (!this.complete && !this.empty) {
      this.interaction.assistant = toolCalls;
      return this;
    } else {
      throw new Error("Cannot append to complete interaction");
    }
  }

  /** Last assistant text message in this thread */
  get assistantResponse(): string {
    if (!this.complete) {
      throw new Error("Cannot get assistant response from incomplete thread");
    }
    if (!this.interaction.assistant || !isText(this.interaction.assistant)) {
      throw new Error("Expected string response");
    }
    return this.interaction.assistant;
  }

  /** Create new thread with last response from agent removed.
   * Beware: this method does not mutate the thread. Always use the return value.
   * @throws Error if the thread is incomplete
   * @returns new Thread object with the last interaction undone
   */
  undo(): Thread {
    if (!this.complete) {
      throw new Error("Cannot undo incomplete interaction");
    }
    const newInteraction = new Interaction(
      this.interaction.user,
      this.interaction.previous
    );
    const newThread = new Thread(this.parent);
    newThread.interaction = newInteraction;
    return newThread;
  }

  /** Create new thread with last user message edited.
   * Beware: this method does not mutate the thread. Always use the return value.
   * @throws Error if the thread is incomplete
   * @param newUserMessage New message to replace the last user message with
   * @returns new Thread object with the last user message replaced
   */
  edit(newUserMessage: string): Thread {
    if (this.empty) {
      throw new Error("Cannot edit empty thread");
    }
    if (this.complete) {
      throw new Error("Cannot edit complete interaction");
    }
    const newInteraction = new Interaction(
      newUserMessage,
      this.interaction.previous
    );
    const newThread = new Thread(this.parent);
    newThread.interaction = newInteraction;
    return newThread;
  }

  /** Create new thread by taking the last user message from `to` and last assistant message from this thread.
   * Beware: this method does not mutate the thread. Always use the return value.
   * @throws Error if the thread is incomplete
   * @throws Error if `to` thread is incomplete
   * @param to Thread to rollup to
   * @returns new Thread object with messages between `to` and `this` rolled up
   */
  rollup(to: Thread, edit?: string): Thread {
    if (this.empty) {
      throw new Error("Cannot rollup empty thread");
    }
    if (!this.complete) {
      throw new Error("Cannot rollup incomplete thread");
    }
    if (to === this) {
      throw new Error("Cannot rollup to self");
    }
    if (to.empty) {
      throw new Error("Cannot rollup to empty thread");
    }
    if (!to.complete) {
      throw new Error("Cannot rollup to incomplete thread");
    }

    const newInteraction = new Interaction(
      edit && typeof to.interaction.user === "string"
        ? `${to.interaction.user}\n${edit}`
        : to.interaction.user,
      to.interaction.previous
    );
    newInteraction.assistant = this.interaction.assistant;
    const newThread = new Thread(this.parent);
    newThread.interaction = newInteraction;
    return newThread;
  }

  conclude(): void {
    this.metadata.timing.finish();
    this.parent.abandon(this);
  }
}
