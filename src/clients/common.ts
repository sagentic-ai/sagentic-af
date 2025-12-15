import { ModelID } from "../models";
import { Message } from "../thread";
import { ClientOptions as OpenAIClientOptionsBase } from "openai";
import { BuiltinToolSpec } from "../builtin-tools";

let isVscode: boolean = false;
let encoding: any;

// check if we have tiktoken
try {
  require.resolve("vscode");
  isVscode = true;
} catch (e) {
  isVscode = false;
}

/**
 * Count the number of tokens in a given text.
 * @param text The text to count tokens for.
 * @returns The number of tokens in the text.
 */
export const countTokens = (text: string): number => {
  // check if we have tiktoken encoding available
  if (isVscode) {
    throw new Error("This function is not supported in VSCode");
  }

  if (!encoding) {
    const { get_encoding } = require("tiktoken");
    encoding = get_encoding("cl100k_base");
  }

  return encoding.encode(text).length;
};

export enum ToolMode {
  AUTO = "auto",
  NONE = "none",
  REQUIRED = "required",
}

/**
 * Reasoning effort levels for models that support configurable reasoning
 * - none: No reasoning, fastest responses (default for GPT-5.1)
 * - minimal: Minimal reasoning (GPT-5 only, not supported by GPT-5.1)
 * - low: Light reasoning
 * - medium: Balanced reasoning (default for GPT-5, O1, O3)
 * - high: Maximum reasoning effort
 */
export enum ReasoningEffort {
  NONE = "none",
  MINIMAL = "minimal",
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
}

/**
 * Verbosity levels for models that support configurable verbosity (GPT-5.1 family)
 * Controls the length and detail of the model's responses
 * - low: Concise, brief responses
 * - medium: Balanced responses (default)
 * - high: Detailed, elaborate responses
 */
export enum Verbosity {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
}

export interface ToolChoice {
  type: "function";
  function: {
    name: string;
  };
}

/**
 * Model invocation options
 */
export type ModelInvocationOptions = {
  tools?: any; //TODO: define tools
  tool_choice?: ToolMode | ToolChoice;
  response_format?: any; //TODO: define response_format
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  /**
   * Reasoning effort for models that support configurable reasoning (GPT-5.1, O1, O3, etc.)
   * Note: When reasoning_effort is not "none", temperature and top_p are not supported
   */
  reasoning_effort?: ReasoningEffort;
  /**
   * Verbosity level for models that support it (GPT-5.1 family)
   * Controls the length and detail of responses: "low", "medium", or "high"
   */
  verbosity?: Verbosity;
  /**
   * Builtin tools to enable (apply_patch, web_search, file_search, code_interpreter, etc.)
   * Only supported in the Responses API.
   */
  builtin_tools?: BuiltinToolSpec[];
};

/**
 * Metadata about the invocation context, useful for analytics and tracking.
 * All fields are optional since different contexts may have different information available.
 * - Client-side (vscode-monk, watcher): typically only source and agentId
 * - Server-side (Session.invokeModel): populates sessionId, modelId, modelProvider
 */
export interface InvocationMetadata {
  /** Unique session ID (e.g., "session-abc123...") */
  sessionId?: string;
  /** Human-readable session topic */
  sessionTopic?: string;
  /** Unique agent ID with class name prefix (e.g., "myagent-abc123...") */
  agentId?: string;
  /** Human-readable agent topic */
  agentTopic?: string;
  /** Model ID being invoked */
  modelId?: string;
  /** Provider handling the request (e.g., "openai", "anthropic", "google") */
  modelProvider?: string;
  /** Source of the invocation (e.g., "vscode-monk", "watcher") */
  source?: string;
}

/**
 * Sagentic Chat completion request
 */
export interface ChatCompletionRequest {
  options?: ModelInvocationOptions;
  model: ModelID;
  messages: Message[];
  /** Optional metadata about the invocation context */
  metadata?: InvocationMetadata;
}

/**
 * Sagentic Chat completion response
 */
export interface ChatCompletionResponse {
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
  messages: Message[];
}

/**
 * Base interface for API clients
 */
export interface Client {
  start(): void;
  stop(): void;
  createChatCompletion(
    request: ChatCompletionRequest
  ): Promise<ChatCompletionResponse>;
}

/**
 * Base options for API clients
 */
export interface BaseClientOptions {
  /** API endpoint URL */
  endpointURL?: string;
  /** Maximum number of attempts to retry a failed request before giving up */
  maxRetries?: number;
  /** Interval for fallback clearing limit counters */
  resetInterval?: number;
}

/** Options for sagentic OpenAI Client */
export interface OpenAIClientOptions
  extends OpenAIClientOptionsBase,
    BaseClientOptions {}

/** Options for sagentic Azure OpenAI Client */
export interface AzureOpenAIClientOptions
  extends OpenAIClientOptionsBase,
    BaseClientOptions {
  resource?: string;
  deployment?: string;
  apiVersion?: string;
}

/** Options for sagentic Google Client */
export interface GoogleClientOptions extends BaseClientOptions {}

/** Options for sagentic Anthropic Client */
export interface AnthropicClientOptions extends BaseClientOptions {}

/** Union type for all client options */
export type ClientOptions =
  | OpenAIClientOptions
  | AzureOpenAIClientOptions
  | OpenAIClientOptionsBase
  | GoogleClientOptions
  | AnthropicClientOptions;
