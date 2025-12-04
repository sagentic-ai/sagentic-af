// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: BUSL-1.1

import OpenAI, { AzureOpenAI, ClientOptions } from "openai";
import { ModelMetadata, BuiltinModel } from "../models";
import {
  OpenAIClientOptions,
  AzureOpenAIClientOptions,
  ChatCompletionRequest,
  ChatCompletionResponse,
  countTokens,
  ReasoningEffort,
  Verbosity,
} from "./common";
import { BaseClient, RejectionReason } from "./base";
import { Message, MessageRole, ToolCall } from "../thread";
import moment from "moment";
import log from "loglevel";

type OpenAIBase = OpenAI | AzureOpenAI;

const defaultAzureEndpointTemplate =
  "https://<resource>.openai.azure.com/openai";
const DEFAULT_AZURE_API_VERSION = "2024-08-01-preview";

const makeAzureOpenAIEndpoint = function (
  endpoint: string,
  resource: string
): string {
  return endpoint.replace(/<resource>/, resource);
};

/** Estimate the number of tokens in a request */
const estimateTokens = (
  request: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming
): number => {
  const text = JSON.stringify(request.messages);
  return countTokens(text);
};

/** Estimate tokens for Responses API request */
const estimateResponsesTokens = (input: string | any[]): number => {
  const text = typeof input === "string" ? input : JSON.stringify(input);
  return countTokens(text);
};

/** Use to parse time durations coming in from OpenAI in headers */
export const parseDuration = (duration: string): moment.Duration => {
  if (duration.length > 64) {
    log.warn(
      "WARNING: duration too long when parsing time in client:",
      duration
    );
    return moment.duration(0);
  }

  duration = duration.toLowerCase();
  const parts = duration.match(/(\d{1,5}(h|ms|m|s))/g);
  if (parts === null) {
    log.warn("WARNING: no parts when parsing time in client:", duration);
    const num = parseInt(duration, 10);
    if (!isNaN(num)) {
      return moment.duration(num, "seconds");
    }
    log.warn("WARNING: unknown duration format:", duration);
    return moment.duration(0);
  }
  const units: Record<string, number> = parts.reduce((acc, part) => {
    const s = part.match(/(\d{1,5})(h|ms|m|s)/);
    if (s === null) {
      log.warn("WARNING: invalid part format:", part);
      return acc;
    }

    const num = parseInt(s[1], 10);

    if (isNaN(num)) {
      log.warn("WARNING: NaN when parsing time in client", s[1], s[2]);
      return acc;
    }

    const unit = {
      s: "seconds",
      m: "minutes",
      h: "hours",
      ms: "milliseconds",
    }[s[2]];

    if (!unit) {
      log.warn("WARNING: unknown unit when parsing time in client", s[2]);
      return acc;
    }

    acc[unit] = num;
    return acc;
  }, {} as Record<string, number>);
  return moment.duration(units);
};

// ============================================================================
// OpenAI Responses API Client (Default)
// ============================================================================

/**
 * OpenAI Responses API Client
 * Uses the new /responses endpoint which supports verbosity and other advanced features.
 */
export class OpenAIResponsesClient extends BaseClient<
  OpenAI.Responses.ResponseCreateParamsNonStreaming,
  OpenAI.Responses.Response,
  OpenAIClientOptions
> {
  protected openai: OpenAI;

  constructor(
    openAIKey: string,
    model: ModelMetadata,
    options?: OpenAIClientOptions
  ) {
    super(model, options);

    const openAIOptions = options || {};
    const origFetch = openAIOptions.fetch || globalThis.fetch;
    openAIOptions.fetch = (
      url: string | URL | globalThis.Request,
      opts?: RequestInit
    ): Promise<Response> => {
      return origFetch(url, opts).then((response) => {
        this.updatePools(response.headers);
        return response;
      });
    };

    const url = options?.endpointURL || model.provider.url;
    this.openai = new OpenAI({
      ...openAIOptions,
      apiKey: openAIKey,
      baseURL: url,
    });
  }

  /**
   * Update pools based on API response.
   */
  protected updatePools = (headers: globalThis.Headers): void => {
    if (headers.has("x-ratelimit-limit-requests")) {
      this.requestPoolMax = parseInt(
        headers.get("x-ratelimit-limit-requests") || "0"
      );
    }

    if (headers.has("x-ratelimit-remaining-requests")) {
      this.requestPool = parseInt(
        headers.get("x-ratelimit-remaining-requests") || "0"
      );
    }

    if (headers.has("x-ratelimit-limit-tokens")) {
      this.tokenPoolMax = parseInt(
        headers.get("x-ratelimit-limit-tokens") || "0"
      );
    }

    if (headers.has("x-ratelimit-remaining-tokens")) {
      this.tokenPool = parseInt(
        headers.get("x-ratelimit-remaining-tokens") || "0"
      );
    }

    if (headers.has("x-ratelimit-reset-requests")) {
      clearTimeout(this.requestTimer);
      const timeToReset = parseDuration(
        headers.get("x-ratelimit-reset-requests") || "0s"
      );
      if (!timeToReset.isValid()) {
        throw new Error("Time to reset requests does not have a valid format");
      }
      this.requestTimer = setTimeout(() => {
        this.requestPool = this.requestPoolMax;
        this.requestTimer = undefined;
        this.tick("req reset");
      }, timeToReset.asMilliseconds());
    }

    if (headers.has("x-ratelimit-reset-tokens")) {
      clearTimeout(this.tokenTimer);
      const timeToReset = parseDuration(
        headers.get("x-ratelimit-reset-tokens") || "0s"
      );
      if (!timeToReset.isValid()) {
        throw new Error("Time to reset tokens does not have a valid format");
      }
      this.tokenTimer = setTimeout(() => {
        this.tokenPool = this.tokenPoolMax;
        this.tokenTimer = undefined;
        this.tick("token reset");
      }, timeToReset.asMilliseconds());
    }
  };

  /**
   * Convert sagentic messages to Responses API input format
   */
  private convertMessagesToInput(
    messages: Message[]
  ): OpenAI.Responses.ResponseInputItem[] {
    const input: OpenAI.Responses.ResponseInputItem[] = [];

    for (const message of messages) {
      if (message.role === MessageRole.System) {
        // System messages are handled via instructions parameter
        continue;
      }

      if (message.role === MessageRole.User) {
        if (typeof message.content === "string") {
          // Use EasyInputMessage format - simplest form
          input.push({
            type: "message",
            role: "user",
            content: message.content,
          });
        } else if (Array.isArray(message.content)) {
          // Multi-part content (e.g., text + images)
          const content: OpenAI.Responses.ResponseInputContent[] = [];
          for (const part of message.content) {
            if (part === null) continue;
            if (typeof part === "string") {
              content.push({ type: "input_text", text: part });
            } else if (part.type === "text") {
              content.push({ type: "input_text", text: part.text });
            } else if (part.type === "image_url") {
              content.push({
                type: "input_image",
                image_url: part.image_url.url,
                detail: "auto",
              });
            }
          }
          input.push({
            type: "message",
            role: "user",
            content,
          });
        }
      } else if (message.role === MessageRole.Assistant) {
        if (message.tool_calls) {
          // Handle tool calls from previous assistant message
          for (const toolCall of message.tool_calls) {
            // Responses API requires function call IDs to start with 'fc_'
            // Convert from Chat Completions format (call_xxx) if needed
            const callId = toolCall.id.startsWith("fc_") 
              ? toolCall.id 
              : `fc_${toolCall.id.replace(/^call_/, "")}`;
            input.push({
              type: "function_call",
              id: callId,
              call_id: callId,
              name: toolCall.function.name,
              arguments: toolCall.function.arguments,
            } as any);
          }
        } else if (typeof message.content === "string" && message.content) {
          // Include assistant text messages for conversation context
          // In manual state management mode, the model doesn't know what it said previously
          input.push({
            type: "message",
            role: "assistant",
            content: message.content,
          });
        }
      } else if (message.role === MessageRole.Tool) {
        // Tool response - convert call_id format if needed
        const callId = message.tool_call_id!.startsWith("fc_")
          ? message.tool_call_id!
          : `fc_${message.tool_call_id!.replace(/^call_/, "")}`;
        input.push({
          type: "function_call_output",
          call_id: callId,
          output: typeof message.content === "string" ? message.content : JSON.stringify(message.content),
        });
      }
    }

    return input;
  }

  /**
   * Extract system prompt from messages
   */
  private extractSystemPrompt(messages: Message[]): string | undefined {
    const systemMessages = messages.filter(
      (m) => m.role === MessageRole.System
    );
    if (systemMessages.length === 0) return undefined;
    return systemMessages
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .join("\n");
  }

  /**
   * Convert Responses API output to sagentic Message format
   */
  private convertOutputToMessages(
    response: OpenAI.Responses.Response
  ): Message[] {
    const messages: Message[] = [];

    // Check if there are function calls in the output
    const functionCalls = response.output.filter(
      (item): item is OpenAI.Responses.ResponseFunctionToolCall =>
        item.type === "function_call"
    );

    if (functionCalls.length > 0) {
      // Convert function calls to tool_calls format
      const toolCalls: ToolCall[] = functionCalls.map((fc) => ({
        id: fc.call_id,
        type: "function" as const,
        function: {
          name: fc.name,
          arguments: fc.arguments,
        },
      }));

      messages.push({
        role: MessageRole.Assistant,
        content: null,
        tool_calls: toolCalls,
      });
    } else {
      // Text response
      messages.push({
        role: MessageRole.Assistant,
        content: response.output_text || "",
      });
    }

    return messages;
  }

  /**
   * Create a chat completion using the Responses API
   */
  async createChatCompletion(
    request: ChatCompletionRequest
  ): Promise<ChatCompletionResponse> {
    const systemPrompt = this.extractSystemPrompt(request.messages);
    const input = this.convertMessagesToInput(request.messages);

    // Build the Responses API request
    const responsesRequest: OpenAI.Responses.ResponseCreateParamsNonStreaming = {
      model: this.model.card.checkpoint,
      input,
      instructions: systemPrompt,
      temperature: request.options?.temperature,
      max_output_tokens: request.options?.max_completion_tokens || request.options?.max_tokens,
      store: false, // Don't store responses by default
    };

    // Handle tools
    if (request.options?.tools && request.options.tools.length > 0) {
      responsesRequest.tools = request.options.tools.map((tool: any) => ({
        type: "function" as const,
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
      }));

      // Handle tool_choice
      if (request.options?.tool_choice) {
        const toolChoice = request.options.tool_choice;
        if (toolChoice === "auto") {
          responsesRequest.tool_choice = "auto";
        } else if (toolChoice === "none") {
          responsesRequest.tool_choice = "none";
        } else if (toolChoice === "required") {
          responsesRequest.tool_choice = "required";
        } else if (typeof toolChoice === "object" && toolChoice.function) {
          responsesRequest.tool_choice = {
            type: "function",
            name: toolChoice.function.name,
          };
        }
      }
    }

    // Handle reasoning effort
    const supportsReasoning = this.model.card.supportsReasoning ?? false;
    const defaultEffort = this.model.card.defaultReasoningEffort ?? "none";
    const reasoningEffort = supportsReasoning
      ? request.options?.reasoning_effort ?? defaultEffort
      : undefined;

    if (supportsReasoning && reasoningEffort && reasoningEffort !== "none") {
      responsesRequest.reasoning = {
        effort: reasoningEffort as "low" | "medium" | "high",
      };
      // When reasoning is enabled, temperature is not supported
      delete responsesRequest.temperature;
    }

    // Handle verbosity (only supported in Responses API)
    const supportsVerbosity = this.model.card.supportsVerbosity ?? false;
    if (supportsVerbosity && request.options?.verbosity) {
      responsesRequest.text = {
        verbosity: request.options.verbosity as "low" | "medium" | "high",
      };
    }

    // Handle JSON mode
    if (request.options?.response_format?.type === "json_object") {
      responsesRequest.text = {
        ...responsesRequest.text,
        format: { type: "json_object" },
      };
    } else if (request.options?.response_format?.type === "json_schema") {
      responsesRequest.text = {
        ...responsesRequest.text,
        format: {
          type: "json_schema",
          ...request.options.response_format,
        },
      };
    }

    // Enqueue and execute request
    const tokens = estimateResponsesTokens(input);
    const response = await this.enqueue(
      this.model.card.supportsImages ? 1000 : tokens,
      responsesRequest
    );

    return {
      usage: response.usage
        ? {
            prompt_tokens: response.usage.input_tokens,
            completion_tokens: response.usage.output_tokens,
          }
        : undefined,
      messages: this.convertOutputToMessages(response),
    } as ChatCompletionResponse;
  }

  /**
   * Make a request to the OpenAI Responses API
   */
  protected async makeAPIRequest(
    request: OpenAI.Responses.ResponseCreateParamsNonStreaming
  ): Promise<OpenAI.Responses.Response> {
    return this.openai.responses.create(request);
  }

  /**
   * Parse an error from the API
   */
  protected parseError(error: any): RejectionReason {
    switch (error.status) {
      case 400:
        return RejectionReason.BAD_REQUEST;
      case 429:
        if (error.error && error.error.code === "insufficient_quota") {
          return RejectionReason.INSUFFICIENT_QUOTA;
        }
        return RejectionReason.TOO_MANY_REQUESTS;
      case 500:
        return RejectionReason.SERVER_ERROR;
      default:
        return RejectionReason.UNKNOWN;
    }
  }
}

// ============================================================================
// OpenAI Chat Completions API Client (Legacy)
// ============================================================================

/** OpenAI Chat Completions API Client wrapper */
export abstract class OpenAIClientBase<
  Options extends ClientOptions
> extends BaseClient<
  OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
  OpenAI.Chat.Completions.ChatCompletion,
  Options
> {
  /** OpenAI client */
  protected abstract openai: OpenAIBase;

  constructor(model: ModelMetadata, options?: Options) {
    super(model, options);
  }

  /**
   * Update pools based on API response.
   */
  protected updatePools = (headers: globalThis.Headers): void => {
    if (headers.has("x-ratelimit-limit-requests")) {
      this.requestPoolMax = parseInt(
        headers.get("x-ratelimit-limit-requests") || "0"
      );
    }

    if (headers.has("x-ratelimit-remaining-requests")) {
      this.requestPool = parseInt(
        headers.get("x-ratelimit-remaining-requests") || "0"
      );
    }

    if (headers.has("x-ratelimit-limit-tokens")) {
      this.tokenPoolMax = parseInt(
        headers.get("x-ratelimit-limit-tokens") || "0"
      );
    }

    if (headers.has("x-ratelimit-remaining-tokens")) {
      this.tokenPool = parseInt(
        headers.get("x-ratelimit-remaining-tokens") || "0"
      );
    }

    if (headers.has("x-ratelimit-reset-requests")) {
      clearTimeout(this.requestTimer);
      const timeToReset = parseDuration(
        headers.get("x-ratelimit-reset-requests") || "0s"
      );
      if (!timeToReset.isValid()) {
        throw new Error("Time to reset requests does not have a valid format");
      }
      this.requestTimer = setTimeout(() => {
        this.requestPool = this.requestPoolMax;
        this.requestTimer = undefined;
        this.tick("req reset");
      }, timeToReset.asMilliseconds());

      if (timeToReset.asMilliseconds() > 10000) {
        log.debug(
          "WARNING: request reset time is greater than 10 seconds",
          timeToReset.asSeconds(),
          this.model.id
        );
      }
    }

    if (headers.has("x-ratelimit-reset-tokens")) {
      clearTimeout(this.tokenTimer);
      const timeToReset = parseDuration(
        headers.get("x-ratelimit-reset-tokens") || "0s"
      );
      if (!timeToReset.isValid()) {
        throw new Error("Time to reset tokens does not have a valid format");
      }
      this.tokenTimer = setTimeout(() => {
        this.tokenPool = this.tokenPoolMax;
        this.tokenTimer = undefined;
        this.tick("token reset");
      }, timeToReset.asMilliseconds());

      if (timeToReset.asMilliseconds() > 10000) {
        log.debug(
          "WARNING: token reset time is greater than 10 seconds",
          timeToReset.asSeconds(),
          this.model.id
        );
      }
    }
  };

  /**
   * Create a chat completion using Chat Completions API
   * Note: verbosity is NOT supported in Chat Completions API
   */
  async createChatCompletion(
    request: ChatCompletionRequest
  ): Promise<ChatCompletionResponse> {
    // O1/O3 models don't support system messages, convert to user
    if (
      this.model.id === BuiltinModel.O1 ||
      this.model.id === BuiltinModel.O1mini ||
      this.model.id === BuiltinModel.O3mini
    ) {
      for (const message of request.messages) {
        if (message.role === MessageRole.System) {
          message.role = MessageRole.User;
        }
      }
    }

    // Determine effective reasoning effort
    const supportsReasoning = this.model.card.supportsReasoning ?? false;
    const defaultEffort = this.model.card.defaultReasoningEffort ?? "none";
    const reasoningEffort = supportsReasoning
      ? request.options?.reasoning_effort ?? defaultEffort
      : undefined;

    // Build the request
    const openaiRequest: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: this.model.card.checkpoint,
      temperature: request.options?.temperature,
      top_p: request.options?.top_p,
      max_tokens: request.options?.max_tokens,
      max_completion_tokens: request.options?.max_completion_tokens,
      tools: request.options?.tools,
      tool_choice: request.options?.tool_choice,
      response_format: request.options?.response_format,
      messages: request.messages as OpenAI.Chat.ChatCompletionMessageParam[],
    };

    // Handle reasoning models
    if (supportsReasoning && reasoningEffort) {
      (openaiRequest as any).reasoning_effort = reasoningEffort;

      // When reasoning_effort is not "none", temperature and top_p are not supported
      if (reasoningEffort !== ReasoningEffort.NONE) {
        delete openaiRequest.temperature;
        delete openaiRequest.top_p;
      }
    }

    // Note: verbosity is NOT supported in Chat Completions API
    // Use OpenAIResponsesClient for verbosity support

    var response: OpenAI.Chat.Completions.ChatCompletion;
    if (this.model.card.supportsImages) {
      response = await this.enqueue(1000, openaiRequest);
    } else {
      const tokens = estimateTokens(openaiRequest);
      response = await this.enqueue(tokens, openaiRequest);
    }
    return {
      usage: response.usage,
      messages: response.choices.map((choice) => choice.message as Message),
    } as ChatCompletionResponse;
  }

  /**
   * Make a request to the OpenAI Chat Completions API
   */
  protected async makeAPIRequest(
    request: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming
  ): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    return this.openai.chat.completions.create(request);
  }

  /**
   * Parse an error from the API
   */
  protected parseError(error: any): RejectionReason {
    switch (error.status) {
      case 400:
        return RejectionReason.BAD_REQUEST;
      case 429:
        if (error.error && error.error.code === "insufficient_quota") {
          return RejectionReason.INSUFFICIENT_QUOTA;
        }
        return RejectionReason.TOO_MANY_REQUESTS;
      case 500:
        return RejectionReason.SERVER_ERROR;
      default:
        return RejectionReason.UNKNOWN;
    }
  }
}

/**
 * OpenAI Chat Completions API Client (Legacy)
 * Use OpenAIResponsesClient for new features like verbosity
 */
export class OpenAIClient extends OpenAIClientBase<OpenAIClientOptions> {
  protected openai: OpenAI;

  constructor(
    openAIKey: string,
    model: ModelMetadata,
    options?: OpenAIClientOptions
  ) {
    super(model, options);

    const openAIOptions = options || {};
    const origFetch = openAIOptions.fetch || globalThis.fetch;
    openAIOptions.fetch = (
      url: string | URL | globalThis.Request,
      opts?: RequestInit
    ): Promise<Response> => {
      return origFetch(url, opts).then((response) => {
        this.updatePools(response.headers);
        return response;
      });
    };

    const url = options?.endpointURL || model.provider.url;
    this.openai = new OpenAI({
      ...openAIOptions,
      apiKey: openAIKey,
      baseURL: url,
    });
  }
}

/**
 * Azure OpenAI Chat Completions API Client (Legacy)
 */
export class AzureOpenAIClient extends OpenAIClientBase<AzureOpenAIClientOptions> {
  protected openai: AzureOpenAI;

  constructor(
    openAIKey: string,
    model: ModelMetadata,
    options?: AzureOpenAIClientOptions
  ) {
    super(model, options);

    const openAIOptions = options || { deployment: "", resource: "" };
    const origFetch = openAIOptions.fetch || globalThis.fetch;
    openAIOptions.fetch = (
      url: string | URL | globalThis.Request,
      opts?: RequestInit
    ): Promise<Response> => {
      return origFetch(url, opts).then((response) => {
        this.updatePools(response.headers);
        return response;
      });
    };

    if (!openAIOptions.apiVersion) {
      openAIOptions.apiVersion = DEFAULT_AZURE_API_VERSION;
    }

    const url =
      options?.endpointURL ||
      model.provider.url ||
      defaultAzureEndpointTemplate;
    const endpoint = makeAzureOpenAIEndpoint(url, openAIOptions.resource || "");
    this.openai = new AzureOpenAI({
      ...openAIOptions,
      apiKey: openAIKey,
      baseURL: endpoint,
    });
  }

  async createChatCompletion(
    request: ChatCompletionRequest
  ): Promise<ChatCompletionResponse> {
    // Determine effective reasoning effort
    const supportsReasoning = this.model.card.supportsReasoning ?? false;
    const defaultEffort = this.model.card.defaultReasoningEffort ?? "none";
    const reasoningEffort = supportsReasoning
      ? request.options?.reasoning_effort ?? defaultEffort
      : undefined;

    const openaiRequest: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: this.model.card.checkpoint.replace(/^azure\//, ""),
      temperature: request.options?.temperature,
      top_p: request.options?.top_p,
      max_tokens: request.options?.max_tokens,
      max_completion_tokens: request.options?.max_completion_tokens,
      tools: request.options?.tools,
      tool_choice: request.options?.tool_choice,
      response_format: request.options?.response_format,
      messages: request.messages as OpenAI.Chat.ChatCompletionMessageParam[],
    };

    // Handle reasoning models
    if (supportsReasoning && reasoningEffort) {
      (openaiRequest as any).reasoning_effort = reasoningEffort;

      if (reasoningEffort !== ReasoningEffort.NONE) {
        delete openaiRequest.temperature;
        delete openaiRequest.top_p;
      }
    }

    // Note: verbosity is NOT supported in Chat Completions API

    var response: OpenAI.Chat.Completions.ChatCompletion;
    if (this.model.card.supportsImages) {
      response = await this.enqueue(1000, openaiRequest);
    } else {
      const tokens = estimateTokens(openaiRequest);
      response = await this.enqueue(tokens, openaiRequest);
    }
    return {
      usage: response.usage,
      messages: response.choices.map((choice) => choice.message as Message),
    } as ChatCompletionResponse;
  }
}
