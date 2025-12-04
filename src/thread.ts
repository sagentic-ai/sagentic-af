// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: BUSL-1.1

import { Agent } from "./agent";
import { ChildOf, Conclusible, Identified, Metadata, meta } from "./common";
import { BuiltinToolCall, BuiltinToolResult } from "./builtin-tools";

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

export interface TextContentPart {
  type: "text";
  text: string;
}

export interface ImageContentPart {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "high" | "low";
  };
}

export type ContentPart = TextContentPart | ImageContentPart;

/** Message sent in a conversation */
export interface Message {
  role: MessageRole;
  content: string | ContentPart[] | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  /** Builtin tool calls from the model (apply_patch, web_search, etc.) */
  builtin_tool_calls?: BuiltinToolCall[];
  /** Builtin tool results to send back to the model */
  builtin_tool_results?: BuiltinToolResult[];
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

export interface ImageEmbed {
  /** Transport of the image */
  transport: "url" | "base64";
  /** URL to the image data, used with "url" transport */
  url?: string;
  /** Base64 encoded image data, used with "base64" data*/
  buffer?: Buffer;
  /** Detail of the image */
  detail?: "auto" | "high" | "low";
}

export interface TextUserContent {
  type: "text";
  text: string;
}

export const text = (text: string): TextUserContent => ({ type: "text", text });

export interface ImageUserContent {
  type: "image";
  text: string;
  images: ImageEmbed[];
}

export interface ToolUserContent {
  type: "tool_results";
  toolResults: ToolResult[];
}

export type UserContent = TextUserContent | ImageUserContent | ToolUserContent;

export interface TextAssistantContent {
  type: "text";
  text: string;
}

export interface ToolAssistantContent {
  type: "tool_calls";
  toolCalls: ToolCall[];
}

export type AssistantContent = TextAssistantContent | ToolAssistantContent;

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
  /** Information sent (or to be sent) by us to OpenAI */
  user: UserContent;
  /** Information received from OpenAI */
  assistant?: AssistantContent;

  /** Create new Interaction
   * @param user Text or tool results sent (or to be sent) by us to OpenAI
   * @param previous Previous interaction in chain, omitting this means this is the first interaction in the chain
   * @returns Interaction
   */
  constructor(user: UserContent, previous?: Interaction) {
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
      this.complete &&
      this.assistant !== undefined &&
      this.assistant.type !== "text"
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
        if (current.assistant && current.assistant.type === "text") {
          // if we have a string response from agent then just put it in a message
          ret.unshift({
            role: MessageRole.Assistant,
            content: current.assistant.text,
          });
        } else if (
          current.assistant &&
          current.assistant.type === "tool_calls"
        ) {
          // if we have a tool call then pack it in a message
          ret.unshift({
            role: MessageRole.Assistant,
            content: null,
            tool_calls: current.assistant.toolCalls,
          });
        } else {
          throw new Error(`Invalid assistant response: ${current.assistant}`);
        }
      }
      if (current.user && current.user.type === "text") {
        // if we have a string prompt from user then just put it in a message
        if (current.user.text !== "")
          ret.unshift({
            role: MessageRole.User,
            content: current.user.text,
          });
      } else if (current.user && current.user.type === "tool_results") {
        // if we have a tool result then unpack it into messages
        const toolResults = current.user.toolResults;
        for (let i = toolResults.length - 1; i >= 0; i--) {
          ret.unshift({
            role: MessageRole.Tool,
            content: toolResults[i].result,
            tool_call_id: toolResults[i].toolCallID,
          });
        }
      } else if (current.user && current.user.type === "image") {
        // if we have an image prompt from user then first put any text in a message and then put any images in messages
        const content: ContentPart[] = [];
        if (current.user.text !== "") {
          content.push({
            type: "text",
            text: current.user.text,
          });
        }
        for (const image of current.user.images) {
          if (image.transport === "url") {
            // if we have an image URL then put it in a message
            if (!image.url) throw new Error("Image URL is missing");
            content.push({
              type: "image_url",
              image_url: {
                url: image.url,
                detail: image.detail,
              },
            });
          } else if (image.transport === "base64") {
            // if we have a base64 image then throw an error as it is not supported for now
            throw new Error("TODO Base64 images are not supported");
          } else {
            throw new Error(`Invalid image transport: ${image.transport}`);
          }
        }
        // put the content in a message
        ret.unshift({
          role: MessageRole.User,
          content: content,
        });
      } else {
        throw new Error(`Invalid user content: ${current.user}`);
      }
      current = current.previous;
    }
    return ret;
  }
}

/**
 * Tracks builtin tool calls and results for a specific interaction point
 */
interface BuiltinToolsContext {
  /** Index of the message (after system prompt adjustment) */
  messageIndex: number;
  /** Builtin tool calls from the model */
  calls?: BuiltinToolCall[];
  /** Builtin tool results to send back */
  results?: BuiltinToolResult[];
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

  /** Builtin tool contexts to inject into messages */
  private builtinToolContexts: BuiltinToolsContext[] = [];

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
    this.interaction = new Interaction(text(""));
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

    // Inject builtin tool contexts into messages
    for (const ctx of this.builtinToolContexts) {
      if (ctx.messageIndex >= 0 && ctx.messageIndex < m.length) {
        if (ctx.calls) {
          m[ctx.messageIndex].builtin_tool_calls = ctx.calls;
        }
        if (ctx.results) {
          m[ctx.messageIndex].builtin_tool_results = ctx.results;
        }
      }
    }

    return m;
  }

  /**
   * Set builtin tool calls and results for a specific message index.
   * This is used by the agent to track builtin tool interactions.
   * @param messageIndex Index of the message (0-based, after system prompt)
   * @param calls Builtin tool calls from the model
   * @param results Builtin tool results to send back
   */
  setBuiltinToolContext(
    messageIndex: number,
    calls?: BuiltinToolCall[],
    results?: BuiltinToolResult[]
  ): void {
    // Update existing context or add new one
    const existing = this.builtinToolContexts.find(
      (ctx) => ctx.messageIndex === messageIndex
    );
    if (existing) {
      if (calls) existing.calls = calls;
      if (results) existing.results = results;
    } else {
      this.builtinToolContexts.push({ messageIndex, calls, results });
    }
  }

  /**
   * Copy builtin tool contexts from another thread.
   * Used when creating a new thread from an existing one.
   */
  copyBuiltinToolContextsFrom(other: Thread): void {
    this.builtinToolContexts = [...other.builtinToolContexts];
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
    return (
      this.interaction.user.type === "text" &&
      this.interaction.user.text.length === 0
    );
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
      if (
        this.interaction.user.type !== "text" &&
        this.interaction.user.type !== "image"
      ) {
        throw new Error(
          "Cannot append user message to tool result interaction"
        );
      }
      // We can safely append string to the user message as both TextUserContent and ImageUserContent have a text field
      this.interaction.user.text += message;
      return this;
    } else {
      if (this.interaction.expectsToolResponse) {
        throw new Error(
          "Cannot append user message to interaction that expects tool response"
        );
      }
      const newInteraction = new Interaction(text(message), this.interaction);
      const newThread = new Thread(this.parent);
      newThread.interaction = newInteraction;
      return newThread;
    }
  }

  /** Append an image to this thread.
   * Beware: this method mutates the thread when it's incomplete. Always use the return value.
   * It is only legal to append image if the thread is not complete.
   * @throws Error if the thread is complete
   * @param message Message to append
   * @param images Images to append
   * @returns new Thread object with the image appended
   */
  appendUserImage(
    url: string,
    options?: { detail: "auto" | "high" | "low" }
  ): Thread {
    if (!this.parent.modelDetails?.supportsImages) {
      throw new Error("This agent does not support images");
    }
    const image: ImageEmbed = {
      transport: "url",
      url,
      detail: options?.detail || undefined,
    };
    if (!this.complete) {
      if (
        this.interaction.user.type !== "text" &&
        this.interaction.user.type !== "image"
      ) {
        throw new Error("Cannot append user image to tool result interaction");
      }

      if (this.interaction.user.type === "image") {
        // if we already have image message then just append the image to it
        this.interaction.user.images.push(image);
      } else if (this.interaction.user.type === "text") {
        // if we already have text message then we promote it to an image message
        this.interaction.user = {
          type: "image",
          text: this.interaction.user.text,
          images: [image],
        };
      }
      return this;
    } else {
      if (this.interaction.expectsToolResponse) {
        throw new Error(
          "Cannot append user message to interaction that expects tool response"
        );
      }
      const newInteraction = new Interaction(
        { type: "image", text: "", images: [image] },
        this.interaction
      );
      const newThread = new Thread(this.parent);
      newThread.interaction = newInteraction;
      return newThread;
    }
  }

  /** Append a video to this thread.
   * Beware: this method mutates the thread when it's incomplete. Always use the return value.
   * It is only legal to append video if the thread is not complete.
   * @throws Error if the thread is complete
   * @param message Message to append
   * @param images Images to append
   * @returns new Thread object with the image appended
   */
  appendUserVideo(
    //TODO finalize this
    video: any,
    options?: any
  ): Thread {
    if (!this.parent.modelDetails?.supportsVideo) {
      throw new Error("This agent does not support images");
    }
    //TODO implement this; need to process video into frames and append them as images
    //audio needs to be extracted and appended as well
    throw new Error("Video is not supported yet");
  }

  /** Append an audio file to this thread.
   * Beware: this method mutates the thread when it's incomplete. Always use the return value.
   * It is only legal to append image if the thread is not complete.
   * @throws Error if the thread is complete
   * @returns new Thread object with the audio appended
   */
  appendUserAudio(
    //TODO finalize this
    audio: any,
    options?: any
  ): Thread {
    if (!this.parent.modelDetails?.supportsAudio) {
      throw new Error("This agent does not support audio");
    }
    //TODO add this once OpenAI supports audio
    throw new Error("Audio is not supported yet");
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
      if (this.interaction.user.type !== "tool_results") {
        throw new Error(
          "Cannot append tool result to text/image prompt interaction"
        );
      }
      this.interaction.user.toolResults.push({ toolCallID, result });
      return this;
    } else {
      if (!this.interaction.expectsToolResponse) {
        throw new Error(
          "Cannot append tool result to interaction that does not expect tool response"
        );
      }
      const newInteraction = new Interaction(
        {
          type: "tool_results",
          toolResults: [{ toolCallID, result }] as ToolResult[],
        },
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
      this.interaction.assistant = { type: "text", text: message };
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
      this.interaction.assistant = { type: "tool_calls", toolCalls };
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
    if (
      !this.interaction.assistant ||
      this.interaction.assistant.type !== "text"
    ) {
      throw new Error("Expected string response");
    }
    return this.interaction.assistant.text;
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
      text(newUserMessage),
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
      edit && to.interaction.user.type === "text"
        ? text(`${to.interaction.user.text}\n${edit}`)
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
