import {
  ChildOf,
  Conclusible,
  Constructor,
  Identified,
  Metadata,
  ParentOf,
  meta,
} from "./common";
import { ModelType } from "./models";
import { ModelInvocationOptions, Session } from "./session";
import { Thread, ToolCall } from "./thread";
import { Tool, ToolSpec } from "./tool";

/** Basic options for an agent */
export interface AgentOptions {
  /** Model type for the agent to use */
  model?: ModelType;
  /** Topic for the agent */
  topic?: string;
  /** Tools for the agent to use */
  tools?: Tool[];
  /** System prompt for the agent */
  systemPrompt?: string;
  /** Eat tool results */
  eatToolResults?: boolean;
  /** Use JSON mode */
  expectsJSON?: boolean;
  /** Temperature for the LLM */
  temperature?: number;
}

/** Agent is the interface for all agents */
export type Agent = BaseAgent<any, any, any>;

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
  implements Identified, Conclusible, ChildOf<Session>, ParentOf<Thread>
{
  metadata: Metadata;

  /** Options for the agent, use to pass custom data in constructor. */
  options: OptionsType;

  /** System prompt, can be undefined if the agent does not need one. */
  systemPrompt?: string;

  /** Model to use for the agent, can be undefined if the agent does not need to talk to any model. */
  model?: ModelType;

  /** State of the agent, initial state is obtained by calling `initialize` */
  state?: StateType = undefined;

  /** Result of the agent, obtained by calling `finalize` */
  result?: ResultType = undefined;

  /** Flag to indicate if the agent is active or not. Agent is only active during `run` */
  isActive: boolean = false;

  /** Tools for the agent to use */
  tools: Tool[] = [];

  /** Flag to indicate whether the tool results should be removed from threads after they were read */
  eatToolResults: boolean = false;

  /** Flag to indicate whether the agent expects JSON output from the LLM */
  expectsJSON: boolean = false;

  /** Temperature to use with the LLM */
  temperature: number = 0.0;

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

  /** Constructs a new agent.
   * @param session the session that the agent belongs to
   * @param options options for the agent
   */
  constructor(session: Session, options?: OptionsType) {
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
    this.threads = [];
  }

  /**
   * Starts the agent. Returns the final result when the agent is done.
   * @returns the final result of the agent's work
   */
  async run(): Promise<ResultType> {
    this.trace(`${this.metadata.ID} run started: ${this.metadata.topic}`);
    this.state = await this.initialize(this.options);
    this.trace("initialize finished", this.state);
    // FIXME: This check doen't make sense when the state is of type void. We need to rethink this.
    // if (!this.state) {
    //   throw new Error("initialize() must return a state");
    // }
    this.isActive = true;
    while (this.isActive && !this.session.isAborted) {
      this.state = await this.step(this.state!);
    }
    this.isActive = false;
    this.result = await this.finalize(this.state);
    this.conclude();
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

    const response = await this.session.invokeModel(
      this,
      this.model,
      messages,
      this.modelInvocationOptions
    );
    let nextThread: Thread;
    if (response.content) {
      nextThread = thread.appendAssistantMessage(response.content);
      if (nextThread !== thread) {
        throw new Error("Thread should have been mutably advanced");
      }
    } else if (response.tool_calls) {
      nextThread = thread.appendAssistantToolCalls(response.tool_calls);
      // now we handle the tool calls by responding to the assistant
      // since tool calls completed the thread, this will not mutate the thread,
      // but will create a new one that we need to adopt
      const nextThread2 = await this.handleToolCalls(nextThread);
      if (nextThread2 === nextThread) {
        throw new Error("Thread should have been immutably advanced");
      }
      this.abandon(nextThread);
      this.adopt(nextThread2);
      // finally we need to invoke the model again to pass the tool responses to the assistant
      // and obtain its response
      const assistantRespondedThread = await this.advance(nextThread2);

      if (this.eatToolResults) {
        const toolCalls: ToolCall[] | string | undefined =
          assistantRespondedThread.interaction.previous?.assistant;

        if (typeof toolCalls === "string" || toolCalls === undefined) {
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
    const options: ModelInvocationOptions = {};
    if (this.tools.length > 0) {
      options.tools = this.describeTools();
    }
    if (this.expectsJSON) {
      options.response_format = { type: "json_object" };
    }
    options.temperature = this.temperature;
    if (Object.keys(options).length > 0) {
      return options;
    }
    return undefined;
  }

  /**
   * Handles tool calls in a given thread by invoking the corresponding tool and appending the result to the thread.
   * Resulting thread still needs to be completed using `advance` to obtain the assistant response.
   * @remarks This method is called by `advance` when the assistant returns tool calls.
   * @param thread The thread containing the tool calls to be handled.
   * @returns A promise that resolves to the updated thread with the tool results appended.
   */
  async handleToolCalls(thread: Thread): Promise<Thread> {
    const toolCalls: ToolCall[] = thread.interaction.assistant as ToolCall[];
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

  /** Create another agent within the session.
   * It delegates to `Session.spawnAgent` in the session of this agent.
   * @param constructor constructor of the agent to create
   * @param options options for the agent
   */
  spawnAgent<T extends Agent>(
    constructor: Constructor<T>,
    options?: AgentOptions
  ): T {
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
