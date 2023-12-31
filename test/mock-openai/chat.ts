import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";
import { countTokens } from "../../src/common";
import moment from "moment";

export type ChatCompletionRequest =
  OpenAI.Chat.ChatCompletionCreateParamsNonStreaming;
export type ChatCompletionResponse = OpenAI.Chat.Completions.ChatCompletion;

const TICKER_UPDATE_INTERVAL = 1000;

const coerceToString = (value: any): string => {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return value.toString();
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return JSON.stringify(value);
};

/**
 * MockChatOptions is a set of options for the MockChatAPI.
 * @param dictionary - dictionary of prompts and responses
 * @param maxRPP - max requests per period
 * @param maxTPP - max tokens per period
 * @param period - period in milliseconds
 * @param contextSize - max tokens per request
 */
export type MockChatOptions = {
  dictionary?: { [key: string]: string }; // dictionary of prompts and responses
  maxRPP?: number; // max requests per period
  maxTPP?: number; // max tokens per period
  period?: number; // period in milliseconds
  contextSize?: number; // max tokens per request
  quota?: number; // lifetime max tokens total
};

/**
 * MockChatAPI is a mock implementation of the OpenAI Chat API.
 * It is intended to be used for testing purposes.
 *
 * It can be configured to return a specific response for a given prompt.
 * It can also be configured to throw errors when the number of requests
 * or tokens exceeds a given limit.
 * @param options MockChatOptions
 */
export class MockChatAPI {
  options: MockChatOptions;
  ticker?: NodeJS.Timeout;
  requests: number;
  tokens: number;
  timeToReset: number;
  totalTokens: number;

  constructor(options?: MockChatOptions) {
    this.options = options || {};
    this.requests = 0;
    this.tokens = 0;
    this.timeToReset = 0;
    this.totalTokens = 0;

    this.initPeriod();
  }

  /**
   * initPeriod (re)initializes the ticker that resets the request and token counters.
   * @returns void
   * @remarks
   * This method is called by the constructor and the setOptions method.
   * It is not intended to be called directly.
   */
  initPeriod() {
    if (this.ticker) {
      clearInterval(this.ticker);
    }

    if (this.options.period) {
      this.timeToReset = this.options.period;
      this.ticker = setInterval(() => {
        this.timeToReset -= TICKER_UPDATE_INTERVAL;
        if (this.timeToReset <= 0) {
          this.requests = 0;
          this.tokens = 0;
          this.timeToReset = this.options.period!;
        }
      }, TICKER_UPDATE_INTERVAL);
    }
  }

  /**
   * setOptions sets the options for the MockChatAPI.
   * @param options MockChatOptions
   * @returns void
   */
  setOptions(options: MockChatOptions) {
    this.options = options;
    this.initPeriod();
  }

  /**
   * close closes the MockChatAPI.
   * @returns void
   * @remarks
   * This method should be called when the MockChatAPI is no longer needed.
   * It stops the ticker that resets the request and token counters.
   */
  close() {
    if (this.ticker) {
      clearInterval(this.ticker);
    }
  }

  /**
   * handleLimits checks if the request exceeds the limits set in the options.
   * @param request
   * @returns void
   * @remarks
   * This method throws an error if the request exceeds the limits set in the options.
   * It also increments the request and token counters.
   * This method is called by the completions method.
   * It is not intended to be called directly.
   */
  handleLimits(request: ChatCompletionRequest) {
    this.requests += 1;

    if (this.options.maxRPP && this.requests > this.options.maxRPP) {
      throw {
        status: 429,
        error: {
          message: "Max requests per period exceeded",
          type: "invalid_request_error",
          param: "messages",
          code: "rate_limit_exceeded",
        },
      };
    }

    let tokens = 0;
    request.messages.forEach((message) => {
      tokens += countTokens(coerceToString(message.content) ?? "");
    });

    if (this.options.contextSize && tokens > this.options.contextSize) {
      throw {
        status: 400,
        error: {
          message: "Max tokens per request exceeded",
          type: "invalid_request_error",
          param: "messages",
          code: "context_length_exceeded",
        },
      };
    }

    this.tokens += tokens;
    this.totalTokens += tokens;
    if (this.options.maxTPP && this.tokens > this.options.maxTPP) {
      throw {
        status: 429,
        error: {
          message: "Max tokens per period exceeded",
          type: "invalid_request_error",
          param: "messages",
          code: "rate_limit_exceeded",
        },
      };
    }
    if (this.options.quota && this.totalTokens > this.options.quota) {
      throw {
        status: 429,
        error: {
          message: "Max tokens exceeded",
          type: "invalid_request_error",
          param: "messages",
          code: "insufficient_quota",
        },
      };
    }
  }

  /**
   * getLimits returns the current state of the rate limits.
   */
  getLimits() {
    // format like the real API, e.g. 6m0s
    // TODO FIXME won't work for periods > 24 hours, fix this
    const timeToReset = moment.utc(this.timeToReset).format("H[h]m[m]s[s]");
    return {
      maxRPP: coerceToString(this.options.maxRPP),
      maxTPP: coerceToString(this.options.maxTPP),
      remainingRPP: coerceToString(
        this.options.maxRPP ? this.options.maxRPP - this.requests : null
      ),
      remainingTPP: coerceToString(
        this.options.maxTPP ? this.options.maxTPP - this.tokens : null
      ),
      timeToReset: coerceToString(timeToReset),
    };
  }

  /**
   * getResponse returns the response for a given prompt.
   * @param request
   * @returns string
   * @remarks
   * This method returns the response for a given prompt.
   * It is called by the completions method.
   * It is not intended to be called directly.
   */
  getResponse(request: ChatCompletionRequest): string {
    if (request.messages.length === 1 && this.options.dictionary) {
      const prompt = coerceToString(request.messages[0].content) ?? "";
      if (prompt in this.options.dictionary) {
        return this.options.dictionary[coerceToString(prompt)];
      }
      return "foobar";
    }

    return "foobar";
  }

  /**
   * completions returns a response for a given prompt.
   * @param request
   * @returns ChatCompletionResponse
   * @remarks
   * This method returns a response for a given prompt.
   * It is intended to be used as a mock implementation of the OpenAI Chat API.
   */
  completions(request: ChatCompletionRequest): ChatCompletionResponse {
    this.handleLimits(request);

    let prompt_tokens = 0;
    request.messages.forEach((message) => {
      prompt_tokens += countTokens(coerceToString(message.content) ?? "");
    });
    const result = this.getResponse(request);
    const completion_tokens = countTokens(result);

    return {
      id: uuidv4(),
      // current unix time in seconds
      created: Math.floor(Date.now() / 1000),
      model: request.model,
      object: "chat.completion",
      usage: {
        completion_tokens: completion_tokens,
        prompt_tokens: prompt_tokens,
        total_tokens: prompt_tokens + completion_tokens,
      },
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: result,
          },
          logprobs: null,
        },
      ],
    };
  }
}
