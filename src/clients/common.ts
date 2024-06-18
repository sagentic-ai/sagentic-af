import { ModelType } from "../models";
import { Message } from "../thread";
import { ClientOptions as OpenAIClientOptionsBase } from "openai";

import { get_encoding } from "tiktoken";

const encoding = get_encoding("cl100k_base");

/**
 * Count the number of tokens in a given text.
 * @param text The text to count tokens for.
 * @returns The number of tokens in the text.
 */
export const countTokens = (text: string): number => {
  return encoding.encode(text).length;
};

/**
 * Model invocation options
 */
export type ModelInvocationOptions = {
  tools?: any; //TODO: define tools
  response_format?: any; //TODO: define response_format
  temperature: number;
  max_tokens?: number;
};

/**
 * Sagentic Chat completion request
 */
export interface ChatCompletionRequest {
  options?: ModelInvocationOptions;
  model: ModelType;
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
  /** Maximum number of attempts to retry a failed request before giving up */
  maxRetries?: number;
  /** Interval for fallback clearing limit counters */
  resetInterval?: number;
}

/** Options for sagentic OpenAI Client */
export interface OpenAIClientOptions
  extends OpenAIClientOptionsBase,
    BaseClientOptions {}

/** Options for sagentic Google Client */
export interface GoogleClientOptions extends BaseClientOptions {}

/** Options for sagentic Anthropic Client */
export interface AnthropicClientOptions extends BaseClientOptions {}

/** Union type for all client options */
export type ClientOptions =
  | OpenAIClientOptions
  | GoogleClientOptions
  | AnthropicClientOptions;
