// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: MIT

import OpenAI, { ClientOptions } from "openai";
import { ModelType, availableModels, pricing } from "./models";
import { countTokens } from "./common";
import moment from "moment";
import fetch, { RequestInfo, RequestInit, Response, Headers } from "node-fetch";

/** Maximum number of attempts to retry a failed request before giving up */
const DEFAULT_MAX_RETRIES = 5;
/** Interval for fallback clearing limit counters */
const DEFAULT_RESET_INTERVAL = 60 * 1000;

/** Generic error message to replace OpenAI API error messages with */
const GENERIC_OPENAI_ERROR = "There was an issue communicating with OpenAI API";

let ids = 0;

/** Ticket is a request waiting to be fulfilled */
interface Ticket {
  id: number;
  tokens: number;
  retries: number;
  request: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming;
  resolve: (
    value:
      | OpenAI.Chat.Completions.ChatCompletion
      | PromiseLike<OpenAI.Chat.Completions.ChatCompletion>
  ) => void;
  reject: (reason?: any) => void;
}

/** Estimate the number of tokens in a request */
const estimateTokens = (
  request: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming
): number => {
  const text = JSON.stringify(request.messages);
  return countTokens(text);
};

/** Options for monkaf Client */
interface ClientOptionsExteded extends ClientOptions {
  /** Maximum number of attempts to retry a failed request before giving up */
  maxRetries?: number;
  /** Interval for fallback clearing limit counters */
  resetInterval?: number;
}

/** OpenAI Client wrapper */
export class Client {
  /** OpenAI client */
  private openai: OpenAI;
  /** Model to use */
  private model: ModelType;

  /** Queue of requests to be sent */
  private queue: Ticket[] = [];

  /** Number of tokens available for use */
  private tokenPool: number = 0;
  /** Maximum number of tokens available for use */
  private tokenPoolMax: number = 0;
  /** Number of requests available for use */
  private requestPool: number = 0;
  /** Maximum number of requests available for use */
  private requestPoolMax: number = 0;

  /** Timer for clearing limit counters */
  private resetTimer?: NodeJS.Timeout;
  /** Timer for resetting request pool */
  private requestTimer?: NodeJS.Timeout;
  /** Timer for resetting token pool */
  private tokenTimer?: NodeJS.Timeout;

  /** Maximum number of attempts to retry a failed request before giving up */
  private maxRetries: number = DEFAULT_MAX_RETRIES;
  /** Interval for fallback clearing limit counters */
  private resetInterval: number = DEFAULT_RESET_INTERVAL;

  /** Set of inflight tickets */
  private inflightTickets: Set<number> = new Set();

  /** Enable debug logging */
  private debug: boolean = false;

  /** Number of allowed tokens per minute */
  get TPM(): number {
    return pricing[this.model].tpm;
  }

  /** Number of allowed requests per minute */
  get RPM(): number {
    return pricing[this.model].rpm;
  }

  /**
   * Create a new Client.
   * @param openAIKey OpenAI API Key
   * @param model Model to use
   * @param options ClientOptions
   * @returns Client
   */
  constructor(
    openAIKey: string,
    model: ModelType,
    options?: ClientOptionsExteded
  ) {
    this.model = model;

    if (options && options.maxRetries) {
      this.maxRetries = options.maxRetries;
    }

    if (options && options.resetInterval) {
      this.resetInterval = options.resetInterval;
    }

    const openAIOptions = options || {};
    const origFetch = openAIOptions.fetch || fetch;
    openAIOptions.fetch = (
      url: RequestInfo,
      opts?: RequestInit
    ): Promise<Response> => {
      return origFetch(url, opts).then((response) => {
        this.updatePools(response.headers);
        return response;
      });
    };

    this.openai = new OpenAI({
      ...openAIOptions,
      apiKey: openAIKey,
    });

    this.tokenPool = this.TPM;
    this.tokenPoolMax = this.TPM;
    this.requestPool = this.RPM;
    this.requestPoolMax = this.RPM;
  }

  /**
   * Start the client. Must be called before using the client.
   * @returns void
   */
  start(): void {
    this.resetTimer = setInterval(() => {
      // fallback to clear/reset pools if for some reason the request headers don't have the rate limit info
      // TODO make this more robust
      if (this.requestPoolMax <= 0) {
        this.requestPoolMax = this.RPM;
      }

      if (this.tokenPoolMax <= 0) {
        this.tokenPoolMax = this.TPM;
      }

      if (!this.requestTimer && this.requestPool < this.requestPoolMax) {
        this.requestPool = this.requestPoolMax;
      }

      if (!this.tokenTimer && this.tokenPool < this.tokenPoolMax) {
        this.tokenPool = this.tokenPoolMax;
      }

      this.tick("timer reset");
    }, this.resetInterval);
  }

  /**
   * Stop the client. Must be called when done using the client.
   * @returns void
   */
  stop(): void {
    clearInterval(this.resetTimer);
    this.resetTimer = undefined;
    clearTimeout(this.requestTimer);
    this.requestTimer = undefined;
    clearTimeout(this.tokenTimer);
    this.tokenTimer = undefined;
  }

  /**
   * Update pools based on API response.
   * @returns void
   */
  private updatePools = (headers: Headers): void => {
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
        if (this.debug)
          console.log(
            "WARNING: request reset time is greater than 10 seconds",
            timeToReset.asSeconds(),
            this.model
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
        if (this.debug)
          console.log(
            "WARNING: token reset time is greater than 10 seconds",
            timeToReset.asSeconds(),
            this.model
          );
      }
    }
  };

  /**
   * Create a chat completion.
   * @param request ChatCompletionCreateParamsNonStreaming
   * @returns Promise<ChatCompletion>
   */
  async createChatCompletion(
    request: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming
  ): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    const tokens = estimateTokens(request);
    return this.enqueue(tokens, request);
  }

  /**
   * Enqueue a request.
   * @param tokens Number of tokens in the request
   * @param request ChatCompletionCreateParamsNonStreaming
   * @returns Promise<ChatCompletion>
   */
  private enqueue(
    tokens: number,
    request: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming
  ): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    const promise = new Promise<OpenAI.Chat.Completions.ChatCompletion>(
      (resolve, reject) => {
        const id = ids++;
        this.queue.push({ id, tokens, request, resolve, reject, retries: 0 });
      }
    );
    this.tick("enqueue");
    return promise;
  }

  /**
   * Tick the queue.
   * @returns void
   */
  private tick(caller: string): void {
    if (this.debug)
      console.log(
        "tick",
        caller,
        this.model,
        this.queue.length,
        this.inflightTickets,
        this.requestPool,
        this.tokenPool,
        "timers",
        !!this.requestTimer,
        !!this.tokenTimer
      );
    if (this.queue.length === 0) {
      return;
    }

    if (this.requestPool <= 0) {
      return;
    }

    const ticket = this.queue.shift();
    if (ticket === undefined) {
      return;
    }

    if (this.tokenPool < ticket.tokens) {
      // reject request if its tokens are greater than the maximum allowed so it could never be fulfilled
      if (ticket.tokens > this.tokenPoolMax) {
        ticket.reject(new Error("Request exceeds maximum allowed tokens"));
        return;
      }

      this.queue.unshift(ticket);
      return;
    }

    this.tokenPool -= ticket.tokens;
    this.requestPool -= 1;

    if (this.debug)
      console.log("processing ticket", ticket.id, "tokens", ticket.tokens);
    this.inflightTickets.add(ticket.id);
    this.openai.chat.completions
      .create(ticket.request)
      .then((response) => {
        if (this.debug) console.log("ticket resolved", ticket.id);
        this.inflightTickets.delete(ticket.id);
        ticket.resolve(response);
      })
      .catch((reason) => {
        if (ticket.retries >= this.maxRetries) {
          // too many retries, give up
          if (this.debug) {
            console.log("ticket rejected: too many retries", ticket.id);
            console.log("reason:", reason);
          }
          this.inflightTickets.delete(ticket.id);
          ticket.reject(GENERIC_OPENAI_ERROR);
          return;
        }

        switch (reason.status) {
          case 400:
            // bad request
            if (this.debug) {
              console.log("ticket rejected: bad request", ticket.id);
              console.log("reason:", reason);
            }
            this.inflightTickets.delete(ticket.id);
            ticket.reject(GENERIC_OPENAI_ERROR);
            return;
          case 429:
            // rate limit or quota
            // reject if we exceeded quota as we can't recover from that
            // otherwise retry
            if (reason.error && reason.error.code === "insufficient_quota") {
              if (this.debug) {
                console.log("ticket rejected: insufficient quota", ticket.id);
                console.log("reason:", reason);
              }
              this.inflightTickets.delete(ticket.id);
              ticket.reject(GENERIC_OPENAI_ERROR);
              return;
            }
            // retry
            break;
          case 500:
            // server error
            // retry
            break;
          default:
            // unknown error
            if (this.debug) {
              console.log("ticket rejected: unknown error", ticket.id);
              console.log("reason:", reason);
            }
            this.inflightTickets.delete(ticket.id);
            ticket.reject(GENERIC_OPENAI_ERROR);
            return;
        }

        // retry
        ticket.retries += 1;
        this.queue.push(ticket);
        if (this.debug) console.log("ticket retrying", ticket.id);
      });

    this.tick("recursive");
  }
}

interface ClientMuxOptions extends ClientOptionsExteded {
  models?: ModelType[];
}

/**
 * ClientMux is a multiplexer for clients of multiple OpenAI models.
 * @param openAIKey OpenAI API Key
 * @param options ClientOptions
 * @returns ClientMux
 */
export class ClientMux {
  private clients: Record<ModelType, Client>;

  constructor(openAIKey: string, options?: ClientMuxOptions) {
    const models = options?.models || availableModels;
    if (models.length === 0) {
      throw new Error("Must provide at least one model");
    }
    this.clients = {} as Record<ModelType, Client>;
    for (const model of models) {
      this.clients[model] = new Client(openAIKey, model, options);
    }
  }

  start(): void {
    for (const client of Object.values(this.clients)) {
      client.start();
    }
  }

  stop(): void {
    for (const client of Object.values(this.clients)) {
      client.stop();
    }
  }

  async createChatCompletion(
    request: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming
  ): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    const model = request.model as ModelType;
    const client = this.clients[model];
    if (client === undefined) {
      throw new Error(`Unknown model: ${model}`);
    }
    return client.createChatCompletion(request);
  }
}

/** Use to parse time durations coming in from OpenAI in headers */
export const parseDuration = (duration: string): moment.Duration => {
  // duration is in an unspecified format so we have to parse it manually before hadingin it off to
  // moment.duration. This format is as follows:
  // 0h0m0s0ms where h, m, s, and ms sections are optional
  // for example: 6h10m0s0ms, 6m0s, 12ms, 55s, 20s200ms, etc.

  if (duration.length > 64) {
    // This is a sanity check to prevent (very unlikely) attack on regular expressions
    console.log(
      "WARNING: duration too long when parsing time in client:",
      duration
    );
    return moment.duration(0);
  }

  duration = duration.toLowerCase();
  const parts = duration.match(/(\d{1,5}(h|ms|m|s))/g);
  if (parts === null) {
    console.log("WARNING: no parts when parsing time in client:", duration);
    return moment.duration(0);
  }
  const units: Record<string, number> = parts.reduce(
    (acc, part) => {
      const s = part.match(/(\d{1,5})(h|ms|m|s)/);
      if (s === null) {
        console.log("WARNING: invalid part format:", part);
        return acc;
      }

      const num = parseInt(s[1], 10);

      if (isNaN(num)) {
        console.log("WARNING: NaN when parsing time in client", s[1], s[2]);
        return acc;
      }

      const unit = {
        s: "seconds",
        m: "minutes",
        h: "hours",
        ms: "milliseconds",
      }[s[2]];

      if (!unit) {
        console.log("WARNING: unknown unit when parsing time in client", s[2]);
        return acc;
      }

      acc[unit] = num;
      return acc;
    },
    {} as Record<string, number>
  );
  return moment.duration(units);
};
