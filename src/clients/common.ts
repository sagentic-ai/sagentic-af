import { ModelType } from "../models";
import { Message } from "../thread";
import { ClientOptions as OpenAIClientOptionsBase } from "openai";

export interface ChatCompletionRequest {
  options?: any; //TODO: define options
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

/** Options for monkaf OpenAI Client */
export interface OpenAIClientOptions extends OpenAIClientOptionsBase {
  /** Maximum number of attempts to retry a failed request before giving up */
  maxRetries?: number;
  /** Interval for fallback clearing limit counters */
  resetInterval?: number;
}

export type ClientOptions = OpenAIClientOptions | any; //TODO get rid of any
