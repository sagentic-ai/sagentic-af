// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: BUSL-1.1

import { ModelMetadata } from "../models";
import {
  Client,
  ChatCompletionRequest,
  ChatCompletionResponse,
  BaseClientOptions,
} from "./common";
import log from "loglevel";

export enum RejectionReason {
  BAD_REQUEST = "bad_request",
  TOO_MANY_REQUESTS = "too_many_requests",
  SERVER_ERROR = "server_error",
  INSUFFICIENT_QUOTA = "insufficient_quota",
  TIMEOUT = "timeout",
  UNKNOWN = "unknown",
}

/** Error class for request timeouts */
export class RequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = "RequestTimeoutError";
  }
}

/** Maximum number of attempts to retry a failed request before giving up */
const DEFAULT_MAX_RETRIES = 5;
/** Interval for fallback clearing limit counters */
const DEFAULT_RESET_INTERVAL = 60 * 1000;
/** Default request timeout: 10 minutes (to handle long LLM requests while defending against hung connections) */
const DEFAULT_REQUEST_TIMEOUT = 10 * 60 * 1000;

/** Ticket is a request waiting to be fulfilled */
interface Ticket<RequestType, ResponseType> {
  id: number;
  tokens: number;
  retries: number;
  request: RequestType;
  resolve: (value: ResponseType | PromiseLike<ResponseType>) => void;
  reject: (reason?: any) => void; //TODO: define reason type
}

/** Base Client wrapper */
export abstract class BaseClient<
  RequestType,
  ResponseType,
  OptionsType extends BaseClientOptions
> implements Client
{
  /** Model to use */
  protected model: ModelMetadata;

  /** Ticket IDs */
  private ids: number = 0;

  /** Queue of requests to be sent */
  private queue: Ticket<RequestType, ResponseType>[] = [];

  /** Number of tokens available for use */
  protected tokenPool: number = 0;
  /** Maximum number of tokens available for use */
  protected tokenPoolMax: number = 0;
  /** Number of requests available for use */
  protected requestPool: number = 0;
  /** Maximum number of requests available for use */
  protected requestPoolMax: number = 0;

  /** Timer for clearing limit counters */
  protected resetTimer?: NodeJS.Timeout;
  /** Timer for resetting request pool */
  protected requestTimer?: NodeJS.Timeout;
  /** Timer for resetting token pool */
  protected tokenTimer?: NodeJS.Timeout;

  /** Maximum number of attempts to retry a failed request before giving up */
  private maxRetries: number = DEFAULT_MAX_RETRIES;
  /** Interval for fallback clearing limit counters */
  private resetInterval: number = DEFAULT_RESET_INTERVAL;
  /** Request timeout in milliseconds (0 = disabled) */
  private requestTimeout: number = DEFAULT_REQUEST_TIMEOUT;

  /** Set of inflight tickets */
  private inflightTickets: Set<number> = new Set();

  /** Enable debug logging */
  protected debug: boolean = true;

  /** Number of allowed tokens per minute */
  get TPM(): number {
    return this.model.card.tpm;
  }

  /** Number of allowed requests per minute */
  get RPM(): number {
    return this.model.card.rpm;
  }

  /**
   * Create a new Client.
   * @param model Model to use
   * @param options ClientOptions
   * @returns Client
   */
  constructor(model: ModelMetadata, options?: OptionsType) {
    this.model = model;

    if (options && options.maxRetries !== undefined) {
      this.maxRetries = options.maxRetries;
    }

    if (options && options.resetInterval) {
      this.resetInterval = options.resetInterval;
    }

    if (options && options.requestTimeout !== undefined) {
      this.requestTimeout = options.requestTimeout;
    }

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
   * Create a chat completion.
   * @param request ChatCompletionRequest
   * @returns Promise<ChatCompletionResponse>
   * @abstract
   */
  abstract createChatCompletion(
    request: ChatCompletionRequest
  ): Promise<ChatCompletionResponse>;

  /**
   * Make an API request.
   * @param request RequestType
   * @param signal Optional AbortSignal for cancellation (used by timeout wrapper)
   * @returns Promise<ResponseType>
   * @abstract
   * @protected
   */
  protected abstract makeAPIRequest(
    request: RequestType,
    signal?: AbortSignal
  ): Promise<ResponseType>;

  /**
   * Parse API error response.
   * @param error any
   * @returns RejectionReason
   * @abstract
   * @protected
   */
  protected abstract parseError(error: any): RejectionReason;

  /**
   * Enqueue a request.
   * @param tokens Number of tokens in the request
   * @param request RequestType
   * @returns Promise<ResponseType>
   */
  protected enqueue(
    tokens: number,
    request: RequestType
  ): Promise<ResponseType> {
    const promise = new Promise<ResponseType>((resolve, reject) => {
      const id = this.ids++;
      this.queue.push({ id, tokens, request, resolve, reject, retries: 0 });
    });
    this.tick("enqueue");
    return promise;
  }

  /**
   * Execute a request with timeout protection.
   * Defends against hung connections (e.g. Deno fetch bug https://github.com/denoland/deno/issues/25992)
   * Uses AbortController to actually cancel hung requests, not just ignore them.
   * @param request The request to execute
   * @param timeoutMs Timeout in milliseconds (0 = no timeout)
   * @returns Promise that rejects with RequestTimeoutError if timeout is exceeded
   */
  private executeWithTimeout(
    request: RequestType,
    timeoutMs: number
  ): Promise<ResponseType> {
    if (timeoutMs <= 0) {
      return this.makeAPIRequest(request);
    }

    const controller = new AbortController();
    const { signal } = controller;

    return new Promise<ResponseType>((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          controller.abort(); // Actually cancel the request
          reject(new RequestTimeoutError(timeoutMs));
        }
      }, timeoutMs);

      // Use unref() so the timer doesn't prevent Node.js from exiting
      if (typeof timer === "object" && "unref" in timer) {
        timer.unref();
      }

      this.makeAPIRequest(request, signal)
        .then((result) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(result);
          }
        })
        .catch((error) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            // Check if this was an abort error (from our timeout)
            if (error.name === "AbortError") {
              reject(new RequestTimeoutError(timeoutMs));
            } else {
              reject(error);
            }
          }
        });
    });
  }

  /**
   * Tick the queue.
   * @returns void
   */
  protected tick(caller: string): void {
    log.debug(
      "tick",
      caller,
      this.model.id,
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

    log.debug("processing ticket", ticket.id, "tokens", ticket.tokens);
    this.inflightTickets.add(ticket.id);
    this.executeWithTimeout(ticket.request, this.requestTimeout)
      .then((response) => {
        log.debug("ticket resolved", ticket.id);
        this.inflightTickets.delete(ticket.id);
        ticket.resolve(response);
      })
      .catch((reason) => {
        if (ticket.retries >= this.maxRetries) {
          // too many retries, give up
          log.debug("ticket rejected: too many retries", ticket.id);
          log.debug("reason:", reason);
          this.inflightTickets.delete(ticket.id);
          ticket.reject(reason);
          return;
        }

        const parsedReason = this.parseError(reason);
        switch (parsedReason) {
          case RejectionReason.BAD_REQUEST:
            // bad request
            log.debug("ticket rejected: bad request", ticket.id);
            log.debug("reason:", reason);
            this.inflightTickets.delete(ticket.id);
            ticket.reject(reason);
            return;
          case RejectionReason.TOO_MANY_REQUESTS:
            log.debug(
              "ticket rejected: too many requests (retrying)",
              ticket.id
            );
            // retry
            break;
          case RejectionReason.INSUFFICIENT_QUOTA:
            log.debug("ticket rejected: insufficient quota", ticket.id);
            log.debug("reason:", reason);
            this.inflightTickets.delete(ticket.id);
            ticket.reject(reason);
            return;
          case RejectionReason.SERVER_ERROR:
            // server error
            log.debug("ticket rejected: server error (retrying)", ticket.id);
            // retry
            break;
          case RejectionReason.TIMEOUT:
            // request timed out (e.g. Deno fetch bug)
            log.debug("ticket rejected: timeout (retrying)", ticket.id);
            // retry
            break;
          case RejectionReason.UNKNOWN:
          default:
            // unknown error
            log.debug("ticket rejected: unknown error", ticket.id);
            log.debug("reason:", reason);
            this.inflightTickets.delete(ticket.id);
            ticket.reject(reason);
            return;
        }

        // retry - remove from inflight before re-queuing
        this.inflightTickets.delete(ticket.id);
        ticket.retries += 1;
        this.queue.push(ticket);
        log.debug("ticket retrying", ticket.id);
        this.tick("retry");
      });

    this.tick("recursive");
  }
}
