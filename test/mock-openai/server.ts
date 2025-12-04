// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: BUSL-1.1

import Fastify, {
  FastifyReply,
  FastifyRequest,
  LightMyRequestResponse,
} from "fastify";
import middie from "@fastify/middie";
import http from "http";
import {
  MockChatAPI,
  MockChatOptions,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ResponsesRequest,
  ResponsesResponse,
} from "./chat";

// hardcoded type matching light-my-request to get around type mismatch
type HTTPMethods =
  | "DELETE"
  | "delete"
  | "GET"
  | "get"
  | "HEAD"
  | "head"
  | "PATCH"
  | "patch"
  | "POST"
  | "post"
  | "PUT"
  | "put"
  | "OPTIONS"
  | "options";

/**
 * ServerOptions are options for the MockOpenAIApi server.
 * @param errorProbability probability of returning an error
 * @param latency latency in ms
 * @param jitter jitter in ms
 * @param logger enable logging
 */
type ServerOptions = {
  errorProbability?: number; // probability of returning an error
  latency?: number; // latency in ms
  jitter?: number; // jitter in ms
  logger?: boolean;
};

/**
 * APIOptions are options for the MockOpenAIApi API.
 * @param chat ChatOptions
 */
type APIOptions = {
  chat?: MockChatOptions;
};

/**
 * MockOpenAIApi is a mock implementation of the OpenAI API.
 * It can be used to test the OpenAI client.
 * It is not a complete implementation of the OpenAI API.
 * It only implements the endpoints used by the OpenAI client.
 */
export class MockOpenAIApi {
  // Use 'any' for app type to work around Fastify v5 type issues in test code
  app: ReturnType<typeof Fastify>;
  chat: MockChatAPI;
  errorProbability: number;
  latency: number;
  jitter: number;
  requests: number = 0;

  /**
   * Create a new MockOpenAIApi.
   * @param options ServerOptions
   * @param apiOptions APIOptions
   * @returns MockOpenAIApi
   */
  constructor(options: ServerOptions = {}, apiOptions: APIOptions = {}) {
    this.app = Fastify({ logger: options.logger });
    this.chat = new MockChatAPI(apiOptions.chat);
    this.errorProbability = options.errorProbability || 0;
    this.latency = options.latency || 0;
    this.jitter = options.jitter || 0;
  }

  /**
   * Change the server options.
   * @param options ServerOptions
   * @returns void
   */
  setServerOptions(options: ServerOptions) {
    if (options.errorProbability) {
      this.errorProbability = options.errorProbability;
    }
    if (options.latency) {
      this.latency = options.latency;
    }
    if (options.jitter) {
      this.jitter = options.jitter;
    }
  }

  /**
   * Change the API options.
   * @param options APIOptions
   * @returns void
   */
  setAPIOptions(options: APIOptions) {
    if (options.chat) {
      this.chat.setOptions(options.chat);
    }
  }

  /**
   * Start the server
   */
  async init() {
    await this.app.register(middie);

    this.app.use(
      async (
        _req: http.IncomingMessage,
        _res: http.ServerResponse,
        next: (err?: unknown) => void
      ) => {
        next();
      }
    );

    this.app.use(
      async (
        _req: http.IncomingMessage,
        res: http.ServerResponse,
        next: (err?: unknown) => void
      ) => {
        // count total requests
        this.requests++;

        // set headers
        res.setHeader("x-mock-openai-api", "true");

        // simulate latency
        await simulateLatency(this.latency, this.jitter);

        // simulate random error
        if (Math.random() < this.errorProbability) {
          res.statusCode = 500;
          res.statusMessage = "random internal error";
          res.end();
          next("random internal error");
        } else {
          next();
        }
      }
    );

    // Chat Completions API endpoint
    this.app.post(
      "/chat/completions",
      async (
        req: FastifyRequest<{ Body: ChatCompletionRequest }>,
        res: FastifyReply
      ): Promise<ChatCompletionResponse> => {
        try {
          const result = this.chat.completions(req.body);
          return result;
        } catch (err: unknown) {
          const error = err as { status?: number; error?: unknown };
          if (error.status) {
            res.statusCode = error.status;
            throw {
              error: error.error,
            };
          }
          throw err;
        } finally {
          const limits = this.chat.getLimits();
          res.header("x-ratelimit-limit-requests", limits.maxRPP);
          res.header("x-ratelimit-limit-tokens", limits.maxTPP);
          res.header("x-ratelimit-remaining-requests", limits.remainingRPP);
          res.header("x-ratelimit-remaining-tokens", limits.remainingTPP);
          res.header("x-ratelimit-reset-requests", limits.timeToReset);
          res.header("x-ratelimit-reset-tokens", limits.timeToReset);
        }
      }
    );

    // Responses API endpoint (new)
    this.app.post(
      "/responses",
      async (
        req: FastifyRequest<{ Body: ResponsesRequest }>,
        res: FastifyReply
      ): Promise<ResponsesResponse> => {
        try {
          const result = this.chat.responses(req.body);
          return result;
        } catch (err: unknown) {
          const error = err as { status?: number; error?: unknown };
          if (error.status) {
            res.statusCode = error.status;
            throw {
              error: error.error,
            };
          }
          throw err;
        } finally {
          const limits = this.chat.getLimits();
          res.header("x-ratelimit-limit-requests", limits.maxRPP);
          res.header("x-ratelimit-limit-tokens", limits.maxTPP);
          res.header("x-ratelimit-remaining-requests", limits.remainingRPP);
          res.header("x-ratelimit-remaining-tokens", limits.remainingTPP);
          res.header("x-ratelimit-reset-requests", limits.timeToReset);
          res.header("x-ratelimit-reset-tokens", limits.timeToReset);
        }
      }
    );
  }

  /**
   * Stop the server
   * @returns void
   */
  stop() {
    this.chat.close();
    this.app.close();
  }

  /**
   * Custom fetch function to be passed to the OpenAI client.
   * Do not call directly.
   */
  fetch = (
    url: string | URL | globalThis.Request,
    init?: RequestInit
  ): Promise<Response> => {
    // Convert Headers object to plain object if needed
    let headers: http.IncomingHttpHeaders = {};
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((value, key) => {
          headers[key] = value;
        });
      } else if (Array.isArray(init.headers)) {
        init.headers.forEach(([key, value]) => {
          headers[key] = value;
        });
      } else {
        headers = init.headers as http.IncomingHttpHeaders;
      }
    }

    return this.app
      .inject({
        method: init?.method as HTTPMethods,
        url: url.toString(),
        headers,
        payload: init?.body || {},
      })
      .then((response: LightMyRequestResponse): Response => {
        return new Response(response.payload, {
          status: response.statusCode,
          statusText: response.statusMessage,
          headers: response.headers as Record<string, string>,
        });
      });
  };
}

/**
 * Simulate latency and jitter.
 * @param latencyMs latency in ms
 * @param jitter jitter in ms
 * @returns void
 */
async function simulateLatency(latencyMs: number, jitter: number) {
  // sleep for latency +- jitter
  const sleepTime = latencyMs + Math.random() * jitter * 2 - jitter;
  await new Promise((resolve) => setTimeout(resolve, sleepTime));
}
