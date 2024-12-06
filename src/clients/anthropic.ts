import Anthropic from "@anthropic-ai/sdk";
import { ModelType, pricing } from "../models";
import {
  AnthropicClientOptions,
  ChatCompletionRequest,
  ChatCompletionResponse,
  countTokens,
} from "./common";
import { BaseClient, RejectionReason } from "./base";
import { Message, MessageRole, ContentPart, TextContentPart } from "../thread";
import fetch from "node-fetch";
import {
  RequestInfo,
  RequestInit,
  Response,
  Headers,
} from "@anthropic-ai/sdk/_shims/node-types.mjs";
import moment from "moment";
import log from "loglevel";

/** Parse messages from sagentic format into anthropic format */
function parseMessages(
  messages: Message[]
): [string, Anthropic.Beta.Tools.ToolsBetaMessageParam[]] {
  let systemPrompt = "";
  const anthropicMessages: Anthropic.Beta.Tools.ToolsBetaMessageParam[] = [];
  for (const message of messages) {
    const msgs = Array.isArray(message.content)
      ? message.content
      : [message.content];
    const parts = msgs
      .filter(
        (msg: string | ContentPart | null) =>
          typeof msg === "string" || (msg && msg.type === "text")
      )
      .map((msg: string | ContentPart | null) => {
        switch (typeof msg) {
          case "string":
            return msg;
          case "object":
            return (msg! as TextContentPart).text;
          default:
            return "";
        }
      });
    for (const part of parts) {
      switch (message.role) {
        case MessageRole.System:
          systemPrompt += part;
          break;
        case MessageRole.User:
          anthropicMessages.push({
            content: part,
            role: "user",
          });
          break;
        case MessageRole.Assistant:
          anthropicMessages.push({
            content: part,
            role: "assistant",
          });
          break;
        case MessageRole.Tool:
          anthropicMessages.push({
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: message.tool_call_id || "",
                content: [
                  {
                    type: "text",
                    text: part,
                  },
                ],
              },
            ],
          });
          break;
        default:
          break;
      }
    }
    const toolCalls = message.tool_calls?.map((toolCall) => {
      return {
        type: "tool_use",
        id: toolCall.id,
        name: toolCall.function.name,
        input: JSON.parse(toolCall.function.arguments),
      } as Anthropic.Beta.Tools.ToolsBetaContentBlock;
    });
    for (const toolCall of toolCalls || []) {
      anthropicMessages.push({
        role: "assistant",
        content: [toolCall],
      });
    }
  }
  return [systemPrompt, anthropicMessages];
}

/** Estimate the number of tokens in a request */
function estimateTokens(
  request: Anthropic.Beta.Tools.MessageCreateParams
): number {
  const text = JSON.stringify(request.messages);
  return countTokens(text);
}

/** Anthropic client */
export class AnthropicClient extends BaseClient<
  Anthropic.Beta.Tools.MessageCreateParams,
  Anthropic.Beta.Tools.ToolsBetaMessage,
  AnthropicClientOptions
> {
  /** Anthropic client */
  private anthropic: Anthropic;

  /**
   * Create a new Anthropic client
   * @param anthropicKey - API key for the Anthropic API
   * @param model - Model to use
   * @param options - Options for the client
   */
  constructor(
    anthropicKey: string,
    model: ModelType,
    options?: AnthropicClientOptions
  ) {
    super(model, options);

    this.anthropic = new Anthropic({
      fetch: (url: RequestInfo, opts?: RequestInit): Promise<Response> => {
        return fetch(url, opts).then((response) => {
          this.updatePools(response.headers);
          return response;
        });
      },
      apiKey: anthropicKey,
    });
  }

  /**
   * Create a new chat completion
   */
  async createChatCompletion(
    request: ChatCompletionRequest
  ): Promise<ChatCompletionResponse> {
    const [systemPrompt, messages] = parseMessages(request.messages);
    const apiRequest = {
      model: this.model,
      max_tokens: 1024,
      messages: messages,
      system: systemPrompt,
      tools: request.options?.tools?.map((tool: any) => {
        return {
          name: tool.function.name,
          description: tool.function.description,
          input_schema: tool.function.parameters,
        } as Anthropic.Beta.Tools.Tool;
      }),
    } as Anthropic.Beta.Tools.MessageCreateParams;

    let response: Anthropic.Beta.Tools.ToolsBetaMessage;
    if (pricing[this.model].supportsImages) {
      // FIXME count tokens without base64 images
      response = await this.enqueue(1000, apiRequest);
    } else {
      const tokens = estimateTokens(apiRequest);
      response = await this.enqueue(tokens, apiRequest);
    }
    const chatResponse = {
      usage: {
        prompt_tokens: response.usage.input_tokens,
        completion_tokens: response.usage.output_tokens,
        total_tokens:
          response.usage.input_tokens + response.usage.output_tokens,
      },
      messages: response.content
        // .filter((msg: Anthropic.Beta.Tools.ToolsBetaContentBlock) => msg.type == "tool_use")
        .map((msg: Anthropic.Beta.Tools.ToolsBetaContentBlock) => {
          if (msg.type === "tool_use") {
            return {
              role: MessageRole.Assistant,
              tool_calls: [
                {
                  id: msg.id,
                  type: "function",
                  function: {
                    name: msg.name,
                    arguments: JSON.stringify(msg.input),
                  },
                },
              ],
            };
          }

          return {
            content: msg.text,
            role: MessageRole.Assistant,
          };
        }),
    } as ChatCompletionResponse;
    return chatResponse;
  }

  /**
   * Make request to the API
   */
  protected async makeAPIRequest(
    request: Anthropic.MessageCreateParams
  ): Promise<Anthropic.Message> {
    return this.anthropic.messages.create(
      request
    ) as Promise<Anthropic.Message>;
  }

  /**
   * Update pools based on API response.
   * @returns void
   */
  private updatePools = (headers: Headers): void => {
    if (headers.has("anthropic-ratelimit-requests-limit")) {
      this.requestPoolMax = parseInt(
        headers.get("anthropic-ratelimit-requests-limit") || "0"
      );
    }

    if (headers.has("anthropic-ratelimit-requests-remaining")) {
      this.requestPool = parseInt(
        headers.get("anthropic-ratelimit-requests-remaining") || "0"
      );
    }

    if (headers.has("anthropic-ratelimit-tokens-limit")) {
      this.tokenPoolMax = parseInt(
        headers.get("anthropic-ratelimit-tokens-limit") || "0"
      );
    }

    if (headers.has("anthropic-ratelimit-tokens-remaining")) {
      this.tokenPool = parseInt(
        headers.get("anthropic-ratelimit-tokens-remaining") || "0"
      );
    }

    if (headers.has("anthropic-ratelimit-requests-reset")) {
      clearTimeout(this.requestTimer);

      const timeToReset = parseDuration(
        headers.get("anthropic-ratelimit-requests-reset") || "0s"
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
          this.model
        );
      }
    }

    if (headers.has("anthropic-ratelimit-tokens-reset")) {
      clearTimeout(this.tokenTimer);

      const timeToReset = parseDuration(
        headers.get("anthropic-ratelimit-tokens-reset") || "0s"
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
          this.model
        );
      }
    }
  };

  /**
   * Parse error from API
   */
  protected parseError(error: any): RejectionReason {
    if (error instanceof Anthropic.APIError) {
      switch (error.status) {
        case 400:
          return RejectionReason.BAD_REQUEST;
        case 429:
          return RejectionReason.TOO_MANY_REQUESTS;
        case 500:
          return RejectionReason.SERVER_ERROR;
        default:
          log.error("unknown anthropic error", error);
          return RejectionReason.UNKNOWN;
      }
    }
    log.error("unknown error making anthropic API request", error);
    return RejectionReason.UNKNOWN;
  }
}

/**
 * Parse duration from RFC 3339 timestamp
 * @param resetTime - RFC 3339 timestamp
 * @returns duration from now
 */
const parseDuration = (resetTime: string): moment.Duration => {
  // Anthropic API returns time when the rate limit will reset in RFC 3339 format
  // we need to parse it and convert to duration from now
  // parse RFC 3339 timestamp
  const resetMoment = moment(resetTime);
  // calculate duration from now
  const duration = moment.duration(resetMoment.diff(moment()));
  if (duration.asMilliseconds() < 0) {
    return moment.duration(0);
  }
  return duration;
};
