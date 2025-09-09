import { ModelID } from "../models";
import { Message } from "../thread";
import { ClientOptions as OpenAIClientOptionsBase } from "openai";

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

export interface ToolChoice {
  type: "function";
  function: {
    name: string;
  }
}

/**
 * Model invocation options
 */
export type ModelInvocationOptions = {
  tools?: any; //TODO: define tools
  tool_choice?: ToolMode | ToolChoice;
  response_format?: any; //TODO: define response_format
  temperature: number;
  max_tokens?: number;
  max_completion_tokens?: number;
};

/**
 * Sagentic Chat completion request
 */
export interface ChatCompletionRequest {
  options?: ModelInvocationOptions;
  model: ModelID;
  messages: Message[];
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
