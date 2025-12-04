// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: BUSL-1.1

import chalk from "chalk";
import {
  ChildOf,
  Conclusible,
  Constructor,
  Identified,
  Metadata,
  ParentOf,
  meta,
} from "./common";
import {
  ModelID,
  BuiltinModel,
  ModelMetadata,
  models,
  resolveModelMetadata,
  ModelCard,
} from "./models";
import { Session } from "./session";
import {
  ModelInvocationOptions,
  ToolChoice,
  ToolMode,
  ReasoningEffort,
  Verbosity,
} from "./clients/common";
import {
  Message,
  MessageRole,
  Thread,
  ToolAssistantContent,
  ToolCall,
} from "./thread";
import { Tool, ToolSpec, SupportingTool } from "./tool";
import {
  BuiltinToolType,
  BuiltinToolSpec,
  BuiltinToolCall,
  BuiltinToolResult,
  BuiltinToolHandler,
  OutputFilterOptions,
  createBuiltinToolSpec,
  createUnhandledError,
  filterOutputItems,
  requiresResponse,
  ApplyPatchCall,
  ApplyPatchResult,
  ComputerUseCall,
  ComputerUseResult,
} from "./builtin-tools";
import { EventEmitter } from "events";

import log from "loglevel";

/** Basic options for an agent */
export interface AgentOptions {
  /** Model type for the agent to use */
  model?: BuiltinModel | ModelMetadata;
  /** Topic for the agent */
  topic?: string;
  /** Tools for the agent to use */
  tools?: Tool[];
  /** Tool choice mode for the agent */
  tool_choice?: ToolMode | ToolChoice;
  /** System prompt for the agent */
  systemPrompt?: string;
  /** Eat tool results */
  eatToolResults?: boolean;
  /** Use JSON mode */
  expectsJSON?: boolean;
  /** Temperature for the LLM */
  temperature?: number;
  /**
   * Reasoning effort for models that support it (GPT-5.1, GPT-5, O1, O3, etc.)
   * Note: When set to anything other than "none", temperature will be ignored
   */
  reasoning_effort?: ReasoningEffort;
  /**
   * Verbosity level for models that support it (GPT-5.1 family)
   * Controls response length/detail: "low", "medium", or "high"
   */
  verbosity?: Verbosity;
  /**
   * Builtin tools to enable (apply_patch, web_search, file_search, etc.)
   * These are OpenAI's built-in tools available in the Responses API.
   * To handle builtin tool calls, register handlers using registerBuiltinToolHandler()
   * or the @handleBuiltinTool decorator.
   */
  builtinTools?: BuiltinToolType[];
  /**
   * Options for configuring specific builtin tools.
   * Key is the BuiltinToolType, value is partial options for that tool.
   */
  builtinToolOptions?: Partial<
    Record<BuiltinToolType, Partial<BuiltinToolSpec>>
  >;
  /**
   * Options for filtering output items before sending back to the model.
   * Useful for hiding certain tool outputs from the conversation.
   */
  outputFilter?: OutputFilterOptions;
}

/** Agent is the interface for all agents */
export type Agent = BaseAgent<any, any, any>;

/** Agent events */
export interface AgentEvents<StateType, ResultType> {
  start: (state: StateType) => void;
  step: (state: StateType) => void;
  stopping: (state: StateType) => void;
  stop: (result: ResultType) => void;
  heartbeat: () => void;
  "llm-request": (messages: Message[]) => void;
  "llm-response": (response: Message) => void;
}

export interface BaseAgent<
  OptionsType extends AgentOptions,
  StateType,
  ResultType
> {
  on<U extends keyof AgentEvents<StateType, ResultType>>(
    event: U,
    listener: AgentEvents<StateType, ResultType>[U]
  ): this;
  emit<U extends keyof AgentEvents<StateType, ResultType>>(
    event: U,
    ...args: Parameters<AgentEvents<StateType, ResultType>[U]>
  ): boolean;
  off<U extends keyof AgentEvents<StateType, ResultType>>(
    event: U,
    listener: AgentEvents<StateType, ResultType>[U]
  ): this;
  once<U extends keyof AgentEvents<StateType, ResultType>>(
    event: U,
    listener: AgentEvents<StateType, ResultType>[U]
  ): this;
}

/**
 * BaseAgent is the base class for all agents.
 * It implements the basic agent lifecycle and convenience functions.
 * It also implements thread management.
 * This class is not directly usable and will throw unimplemented.
 * To implement a custom agent, extend this class (see `initialize`, `finalize` and `step` methods).
 * @param OptionsType options for the agent
 * @param StateType state of the agent
 * @param ResultType result of the agent
 */
export class BaseAgent<OptionsType extends AgentOptions, StateType, ResultType>
  extends EventEmitter
  implements
    Identified,
    Conclusible,
    ChildOf<Session>,
    ParentOf<Thread>,
    SupportingTool
{
  metadata: Metadata;

  /** Options for the agent, use to pass custom data in constructor. */
  options: OptionsType;

  /** System prompt, can be undefined if the agent does not need one. */
  systemPrompt?: string;

  /** Model to use for the agent, can be undefined if the agent does not need to talk to any model.
   * Can be a built-in model type or a custom model card (possibly extending an existing one).
   */
  model?: BuiltinModel | ModelMetadata;

  /** State of the agent, initial state is obtained by calling `initialize` */
  state?: StateType = undefined;

  /** Result of the agent, obtained by calling `finalize` */
  result?: ResultType = undefined;

  /** Flag to indicate if the agent is active or not. Agent is only active during `run` */
  isActive: boolean = false;

  /** Tools for the agent to use */
  tools: Tool[] = [];

  /** Tool mode for the agent to use. */
  tool_choice?: ToolMode | ToolChoice;

  /** Flag to indicate whether the tool results should be removed from threads after they were read */
  eatToolResults: boolean = false;

  /** Flag to indicate whether the agent expects JSON output from the LLM */
  expectsJSON: boolean = false;

  /** Temperature to use with the LLM */
  temperature: number = 0.0;

  /** Reasoning effort for models that support configurable reasoning */
  reasoning_effort?: ReasoningEffort = undefined;

  /** Verbosity level for models that support it (GPT-5.1 family) */
  verbosity?: Verbosity = undefined;

  /** Maximum tokens to produce */
  maxTokens?: number = undefined;

  /** Maximum completion tokens to produce */
  maxCompletionTokens?: number = undefined;

  /** Builtin tools enabled for this agent */
  builtinTools: BuiltinToolType[] = [];

  /** Options for specific builtin tools */
  builtinToolOptions: Partial<
    Record<BuiltinToolType, Partial<BuiltinToolSpec>>
  > = {};

  /** Output filter options */
  outputFilter?: OutputFilterOptions = undefined;

  /** Registry for builtin tool handlers */
  private builtinToolHandlers: Map<string, BuiltinToolHandler<any, any>> =
    new Map();

  /** Used to track threads that the agent is managing */
  private threads: Thread[];

  get parent(): Session {
    if (!this.metadata.parent) {
      throw new Error("Agent has no parent");
    }
    return this.metadata.parent! as Session;
  }

  /** Session that the agent belongs to, alias to `parent` */
  get session(): Session {
    return this.parent;
  }

  /** Model details */
  get modelDetails(): ModelCard | undefined {
    if (this.model) {
      return resolveModelMetadata(this.model).card;
    }
    return undefined;
  }

  /** Constructs a new agent.
   * @param session the session that the agent belongs to
   * @param options options for the agent
   */
  constructor(session: Session, options?: OptionsType) {
    super();
    this.metadata = meta(
      this.constructor as Constructor<Identified>,
      options?.topic
    );
    this.metadata.parent = session;
    this.options = options || ({} as OptionsType);
    this.model = this.model || this.options?.model;
    this.tools = this.tools || this.options?.tools || [];
    this.systemPrompt = this.systemPrompt || this.options?.systemPrompt;
    this.eatToolResults =
      this.eatToolResults || this.options?.eatToolResults || false;
    this.expectsJSON = this.expectsJSON || this.options?.expectsJSON || false;
    this.temperature = this.temperature || this.options?.temperature || 0.0;
    this.reasoning_effort =
      this.reasoning_effort || this.options?.reasoning_effort;
    this.verbosity = this.verbosity || this.options?.verbosity;
    this.builtinTools =
      this.builtinTools.length > 0
        ? this.builtinTools
        : this.options?.builtinTools || [];
    this.builtinToolOptions =
      Object.keys(this.builtinToolOptions).length > 0
        ? this.builtinToolOptions
        : this.options?.builtinToolOptions || {};
    this.outputFilter = this.outputFilter || this.options?.outputFilter;
    this.threads = [];
  }

  /**
   * Starts the agent. Returns the final result when the agent is done.
   * @returns the final result of the agent's work
   */
  async run(): Promise<ResultType> {
    log.info("Agent", chalk.yellow(this.metadata.ID), chalk.blue("start"));
    this.trace(`${this.metadata.ID} run started: ${this.metadata.topic}`);
    this.state = await this.initialize(this.options);
    this.trace("initialize finished", this.state);
    // FIXME: This check doen't make sense when the state is of type void. We need to rethink this.
    // if (!this.state) {
    //   throw new Error("initialize() must return a state");
    // }
    this.isActive = true;
    this.emit("start", this.state);
    while (this.isActive && !this.session.isAborted) {
      this.heartbeat();
      this.state = await this.step(this.state!);
      this.emit("step", this.state);
    }
    this.isActive = false;
    this.emit("stopping", this.state);
    this.result = await this.finalize(this.state);
    this.emit("stop", this.result);
    this.conclude();
    log.info(
      "Agent",
      chalk.yellow(this.metadata.ID),
      chalk.green("done"),
      chalk.gray(
        `(took ${this.metadata.timing.elapsed.as("seconds").toFixed(2)}s)`
      )
    );
    return this.result;
  }

  /** Indicates that the agent should be stopped.
   * Call only from `step` to finish agent's work.
   */
  stop(): void {
    if (!this.isActive) {
      throw new Error("Agent is not active");
    }
    this.isActive = false;
  }

  /** Initializes the agent.
   * Used to set up the initial state of the agent.
   * Is called before first invocation of `step`.
   * Implement this when extending the class.
   * @param _options options for the agent
   * @returns the initial state of the agent
   */
  async initialize(_options: OptionsType): Promise<StateType> {
    throw new Error("initialize() not implemented");
  }

  /** Finalizes the agent.
   * Used to finalize the agent's work and obtain the final result.
   * Implement this when extending the class.
   * @param _finalState the final state of the agent
   * @returns the final result of the agent
   */
  async finalize(_finalState: StateType): Promise<ResultType> {
    throw new Error("finalize() not implemented");
  }

  /** Steps the agent.
   * Used to advance the agent's work.
   * Is called repeatedly until `stop` is called.
   * Implement this when extending the class.
   * @param _finalState the final state of the agent
   * @returns the next state of the agent
   */
  async step(_finalState: StateType): Promise<StateType> {
    throw new Error("step() not implemented");
  }

  /** Creates a new thread for the agent and adopts it.
   * @returns the new thread
   */
  createThread(): Thread {
    const thread = new Thread(this);
    this.adopt(thread);
    return thread;
  }

  /** Advances the thread by sending it to the model.
   * This might take a while, as it waits for the model to respond.
   * The thread is advanced mutably, so the same thread is returned.
   * This essentially appends the model's response to the thread.
   * @param thread the thread to advance
   * @returns the next thread
   */
  async advance(thread: Thread): Promise<Thread> {
    if (!this.model) {
      throw new Error("Model not set");
    }
    if (thread.metadata.parent !== this) {
      throw new Error("Thread already has a different parent");
    }
    if (!this.threads.includes(thread)) {
      throw new Error("Thread not adopted");
    }
    if (thread.complete) {
      throw new Error("Thread is complete");
    }
    const messages = thread.messages;
    this.emit("llm-request", messages);
    const response = await this.session.invokeModel(
      this,
      resolveModelMetadata(this.model),
      messages,
      this.modelInvocationOptions
    );
    this.emit("llm-response", response);
    let nextThread: Thread;

    // Check for builtin tool calls (apply_patch, web_search, etc.)
    const hasBuiltinToolCalls =
      response.builtin_tool_calls && response.builtin_tool_calls.length > 0;
    const hasRegularToolCalls =
      response.tool_calls && response.tool_calls.length > 0;

    if (
      response.content &&
      typeof response.content === "string" &&
      !hasBuiltinToolCalls &&
      !hasRegularToolCalls
    ) {
      // Pure text response
      nextThread = thread.appendAssistantMessage(response.content);
      if (nextThread !== thread) {
        throw new Error("Thread should have been mutably advanced");
      }
    } else if (hasRegularToolCalls || hasBuiltinToolCalls) {
      // Handle tool calls (regular and/or builtin)

      if (hasRegularToolCalls) {
        nextThread = thread.appendAssistantToolCalls(response.tool_calls!);
        // Handle regular tool calls
        const nextThread2 = await this.handleToolCalls(nextThread);
        if (nextThread2 === nextThread) {
          throw new Error("Thread should have been immutably advanced");
        }
        this.abandon(nextThread);
        this.adopt(nextThread2);
        nextThread = nextThread2;

        // Handle builtin tool calls if also present
        if (hasBuiltinToolCalls) {
          let builtinCalls = response.builtin_tool_calls!;
          if (this.outputFilter) {
            builtinCalls = filterOutputItems(builtinCalls, this.outputFilter);
          }
          const builtinResults = await this.handleBuiltinToolCalls(
            builtinCalls
          );

          // Store using thread's context system
          // The builtin calls are part of the assistant message (which has the tool_calls)
          // We need to find the assistant message index
          const messagesCount = nextThread.messages.length;
          // Find the last assistant message
          for (let i = messagesCount - 1; i >= 0; i--) {
            if (nextThread.messages[i].role === MessageRole.Assistant) {
              nextThread.setBuiltinToolContext(
                i,
                response.builtin_tool_calls,
                builtinResults
              );
              break;
            }
          }
        }
      } else {
        // Only builtin tool calls - no regular tool calls
        // We treat this similarly to regular tool calls:
        // 1. Record the builtin calls as an "assistant" response
        // 2. Handle them
        // 3. Create a new thread with user message containing results
        // 4. Recursive advance to get text response

        // Process builtin tool calls first
        let builtinCalls = response.builtin_tool_calls!;
        if (this.outputFilter) {
          builtinCalls = filterOutputItems(builtinCalls, this.outputFilter);
        }
        const builtinResults = await this.handleBuiltinToolCalls(builtinCalls);

        // agent might've been stopped in the tool handler
        if (!this.isActive) {
          return thread.appendAssistantMessage(
            "Agent has been stopped, no further responses will be generated."
          );
        }

        // Complete current thread with a note about builtin tool calls
        // This way the thread record shows what happened
        const callsSummary = builtinCalls
          .map((c) => `${c.type}(${(c as any).operation?.path || c.id})`)
          .join(", ");
        nextThread = thread.appendAssistantMessage(
          `[Executed builtin tools: ${callsSummary}]`
        );

        // Store builtin info using the thread's context system
        const messagesCount = nextThread.messages.length;
        const assistantMsgIndex = messagesCount - 1; // Last message is the assistant message
        nextThread.setBuiltinToolContext(
          assistantMsgIndex,
          response.builtin_tool_calls,
          builtinResults
        );

        // Now create a new interaction (like after tool results)
        // The thread is complete so this creates a new interaction
        const threadWithContext = nextThread;
        const nextThread2 = nextThread.appendUserMessage(
          "[Builtin tool results submitted]"
        );
        this.abandon(nextThread);
        this.adopt(nextThread2);
        nextThread = nextThread2;

        // Copy builtin tool contexts from thread before the user message was added
        nextThread.copyBuiltinToolContextsFrom(threadWithContext);
      }

      // agent might've been stopped in the tool handler,
      // so we need to check if it is still active
      if (!this.isActive) {
        // we need to append dummy assistant response to complete the thread
        if (!nextThread.complete) {
          return nextThread.appendAssistantMessage(
            "Agent has been stopped, no further responses will be generated."
          );
        }
        return nextThread;
      }

      // finally we need to invoke the model again to pass the tool responses to the assistant
      // and obtain its response
      const assistantRespondedThread = await this.advance(nextThread);

      if (this.eatToolResults && hasRegularToolCalls) {
        const toolCalls: ToolCall[] | undefined = (
          assistantRespondedThread.interaction.previous?.assistant as
            | ToolAssistantContent
            | undefined
        )?.toolCalls;

        if (toolCalls === undefined) {
          throw new Error("Invalid tool calls when eating tool results");
        }

        const threadWithoutToolResults = assistantRespondedThread.rollup(
          thread,
          `You have called tools: ${JSON.stringify(
            toolCalls.map((t) => t.function)
          )} but the results have been removed from the conversation. See the following note.`
        );

        this.abandon(assistantRespondedThread);
        this.adopt(threadWithoutToolResults);
        return threadWithoutToolResults;
      }

      return assistantRespondedThread;
    } else {
      throw new Error("Invalid response");
    }

    return nextThread;
  }

  /** Describes the tools that the agent uses.
   * @returns the OpenAI schema for the tools that the agent can use
   */
  describeTools(): ToolSpec[] {
    const tools = this.tools.map((t) => t.describe());
    return tools;
  }

  /** Model invocation options that the agent uses.
   * Contains tools to use and other options accepted by OpenAI.
   */
  get modelInvocationOptions(): ModelInvocationOptions | undefined {
    const options: ModelInvocationOptions = {
      temperature: this.temperature,
    };
    if (this.tools.length > 0) {
      options.tools = this.describeTools();
    }
    if (this.tool_choice) {
      options.tool_choice = this.tool_choice;
    }
    if (this.expectsJSON) {
      options.response_format = { type: "json_object" };
    }

    if (this.maxTokens !== undefined) {
      options.max_tokens = this.maxTokens;
    }

    if (this.maxCompletionTokens !== undefined) {
      options.max_completion_tokens = this.maxCompletionTokens;
    }

    if (this.reasoning_effort !== undefined) {
      options.reasoning_effort = this.reasoning_effort;
    }

    if (this.verbosity !== undefined) {
      options.verbosity = this.verbosity;
    }

    // Add builtin tools
    if (this.builtinTools.length > 0) {
      options.builtin_tools = this.describeBuiltinTools();
    }

    if (Object.keys(options).length > 0) {
      return options;
    }
    return undefined;
  }

  /**
   * Describe the builtin tools that the agent uses.
   * @returns Array of BuiltinToolSpec objects
   */
  describeBuiltinTools(): BuiltinToolSpec[] {
    return this.builtinTools.map((type) =>
      createBuiltinToolSpec(type, this.builtinToolOptions[type])
    );
  }

  /**
   * Handles tool calls in a given thread by invoking the corresponding tool and appending the result to the thread.
   * Resulting thread still needs to be completed using `advance` to obtain the assistant response.
   * @remarks This method is called by `advance` when the assistant returns tool calls.
   * @param thread The thread containing the tool calls to be handled.
   * @returns A promise that resolves to the updated thread with the tool results appended.
   */
  async handleToolCalls(thread: Thread): Promise<Thread> {
    if (thread.interaction.assistant?.type !== "tool_calls") {
      throw new Error("Thread does not contain tool calls");
    }
    const toolCalls: ToolCall[] = thread.interaction.assistant.toolCalls;
    for (const toolCall of toolCalls) {
      try {
        // find the tool
        const tool: Tool | undefined = this.tools.find(
          (t) => t.name === toolCall.function.name
        );
        if (!tool) {
          throw new Error(`Tool ${toolCall.function.name} not found`);
        }
        // invoke the tool
        const parsedArguments = JSON.parse(toolCall.function.arguments);
        const result = await tool.invoke(this, parsedArguments);
        // append the result to current thread
        thread = thread.appendToolResult(toolCall.id, JSON.stringify(result));
      } catch (err: any) {
        // when something goes wrong, we need to respond with an error to the particular tool call
        // we don't throw to the caller
        this.trace("tool error", toolCall.function.name, err);
        thread = thread.appendToolResult(
          toolCall.id,
          `TOOL ERROR: ${err.message}`
        );
      }
    }
    // at this stage we have appended all the tool results to the thread
    return thread;
  }

  // ============================================================================
  // Builtin Tool Handler Registration
  // ============================================================================

  /**
   * Register a handler for a builtin tool type.
   * The handler will be called when the model emits a tool call of this type.
   * @param type The builtin tool call type (e.g., "apply_patch_call")
   * @param handler The async function to handle the tool call
   *
   * @example
   * ```typescript
   * this.registerBuiltinToolHandler("apply_patch_call", async (call: ApplyPatchCall) => {
   *   // Apply the patch to your filesystem
   *   await applyPatch(call.operation);
   *   return { call_id: call.call_id, status: "completed" };
   * });
   * ```
   */
  /**
   * @internal Used by decorators - made public for decorator access
   */
  registerBuiltinToolHandler<
    T extends BuiltinToolCall,
    R extends BuiltinToolResult | void
  >(type: string, handler: BuiltinToolHandler<T, R>): void {
    this.builtinToolHandlers.set(type, handler);
    log.debug(
      chalk.yellow(this.metadata.ID),
      chalk.blue("registered builtin tool handler"),
      type
    );
  }

  /**
   * Check if a handler is registered for a builtin tool type.
   * @param type The builtin tool call type
   * @returns true if a handler is registered
   */
  protected hasBuiltinToolHandler(type: string): boolean {
    return this.builtinToolHandlers.has(type);
  }

  /**
   * Handle builtin tool calls from the model response.
   * Invokes registered handlers and returns results to send back to the model.
   * @param calls Array of builtin tool calls from the model
   * @returns Array of results to send back to the model
   */
  protected async handleBuiltinToolCalls(
    calls: BuiltinToolCall[]
  ): Promise<BuiltinToolResult[]> {
    const results: BuiltinToolResult[] = [];

    for (const call of calls) {
      const handler = this.builtinToolHandlers.get(call.type);

      if (handler) {
        try {
          const result = await handler(call);
          if (result) {
            results.push(result);
          }
          log.info(
            chalk.yellow(this.metadata.ID),
            chalk.green("builtin tool"),
            call.type,
            chalk.gray(`(id: ${call.id})`)
          );
        } catch (err: any) {
          this.trace("builtin tool error", call.type, err);
          // Create error result for tools that require responses
          if (requiresResponse(call.type)) {
            if (call.type === "apply_patch_call") {
              results.push({
                call_id: (call as ApplyPatchCall).call_id,
                status: "failed",
                output: `BUILTIN TOOL ERROR: ${err.message}`,
              } as ApplyPatchResult);
            } else if (call.type === "computer_call") {
              results.push({
                call_id: (call as ComputerUseCall).call_id,
              } as ComputerUseResult);
            }
          }
        }
      } else {
        // No handler registered - create error result and warn
        const errorResult = createUnhandledError(call);
        if (errorResult) {
          results.push(errorResult);
        }
      }
    }

    return results;
  }

  /** Create another agent within the session.
   * It delegates to `Session.spawnAgent` in the session of this agent.
   * @param constructor constructor of the agent to create
   * @param options options for the agent
   */
  spawnAgent<T extends Agent>(
    constructor: Constructor<T>,
    options?: AgentOptions
  ): T {
    log.info(
      chalk.yellow(this.metadata.ID),
      chalk.blue("spawn"),
      constructor.name
    );
    return this.session.spawnAgent(constructor, options);
  }

  adopt(child: Thread): void {
    if (child.metadata.parent !== this) {
      throw new Error("Thread already has a different parent");
    }
    if (this.threads.includes(child)) {
      throw new Error("Thread already adopted");
    }
    this.threads.push(child);
  }

  abandon(child: Thread): void {
    if (!this.threads.includes(child)) {
      throw new Error("Thread not adopted");
    }
    this.threads = this.threads.filter((t) => t !== child);
  }

  conclude(): void {
    if (this.isActive) {
      throw new Error("Can't conclude an active Agent");
    }
    for (const thread of this.threads) {
      thread.conclude();
    }
    this.metadata.timing.finish();
    this.parent.abandon(this);
  }

  /** Notify session that the agent is still active. Use in long-running side-effects (e.g. tool invocations, long external requests, etc.) to prevent timeouts. This method is automatically called in `step` so you don't need to call it manually in most cases. */
  heartbeat(): void {
    this.emit("heartbeat");
  }

  notify(...stuff: any[]): number | undefined {
    if (this.parent) {
      if (typeof stuff[0] === "object") {
        stuff[0].agent = this.metadata.ID;
      } else {
        stuff.unshift({ agent: this.metadata.ID });
      }
      return this.parent.notify(...stuff);
    }
    return undefined;
  }

  trace(...stuff: any[]): number | undefined {
    if (this.parent) {
      return this.parent.trace(...stuff);
    }
    return undefined;
  }
}

// ============================================================================
// Builtin Tool Handler Decorator
// ============================================================================

/**
 * Decorator to register a method as a handler for a specific builtin tool type.
 *
 * @param type The builtin tool call type to handle (e.g., "apply_patch_call")
 *
 * @example
 * ```typescript
 * class MyAgent extends BaseAgent<MyOptions, MyState, MyResult> {
 *   builtinTools = [BuiltinToolType.ApplyPatch];
 *
 *   @handleBuiltinTool("apply_patch_call")
 *   async handleApplyPatch(call: ApplyPatchCall): Promise<ApplyPatchResult> {
 *     // Implement your patch harness logic here
 *     const { operation } = call;
 *     if (operation.type === "create_file") {
 *       await fs.writeFile(operation.path, applyDiff("", operation.diff));
 *     } else if (operation.type === "update_file") {
 *       const content = await fs.readFile(operation.path, "utf-8");
 *       await fs.writeFile(operation.path, applyDiff(content, operation.diff));
 *     } else if (operation.type === "delete_file") {
 *       await fs.unlink(operation.path);
 *     }
 *     return { call_id: call.call_id, status: "completed" };
 *   }
 * }
 * ```
 */
export function handleBuiltinTool(type: string) {
  return function <
    This extends BaseAgent<any, any, any>,
    Args extends [BuiltinToolCall],
    Return extends Promise<BuiltinToolResult | void>
  >(
    target: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<
      This,
      (this: This, ...args: Args) => Return
    >
  ) {
    context.addInitializer(function () {
      this.registerBuiltinToolHandler(type, target.bind(this) as any);
    });
    return target;
  };
}
