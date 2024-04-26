import { ModelType } from "../models";
import { Message } from "../thread";
import { ClientOptions as OpenAIClientOptionsBase } from "openai";

export type ModelInvocationOptions = {
  tools?: any; //TODO: define tools
  response_format?: any; //TODO: define response_format
  temperature: number;
  max_tokens?: number;
};

export interface ChatCompletionRequest {
  options?: ModelInvocationOptions;
  model: ModelType;
  messages: Message[];
}

export interface ChatCompletionResponse {
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
  messages: Message[];
}

export interface Client {
  start(): void;
  stop(): void;
  createChatCompletion(
    request: ChatCompletionRequest
  ): Promise<ChatCompletionResponse>;
}

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
type GoogleClientOptionsBase = any; //TODO: define GoogleClientOptionsBase
export interface GoogleClientOptions
  extends GoogleClientOptionsBase,
    BaseClientOptions {}

export type ClientOptions = OpenAIClientOptions | GoogleClientOptions;
