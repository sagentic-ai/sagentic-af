// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: BUSL-1.1

import fastify, {
  FastifyListenOptions,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import middie from "@fastify/middie";
import http from "http";
import { Fetch } from "openai/core";
import fetch, { RequestInfo, RequestInit, Response } from "node-fetch";
import {
  MockChatAPI,
  MockChatOptions,
  ChatCompletionRequest,
  ChatCompletionResponse,
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
 * It can be used to test the aipacks OpenAI client.
 * It is not a complete implementation of the OpenAI API.
 * It only implements the endpoints used by the aipacks OpenAI client.
 */
export class MockOpenAIApi {
  app: FastifyInstance;
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
    this.app = fastify({ logger: options.logger });
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
        req: http.IncomingMessage,
        res: http.ServerResponse,
        next: (err?: any) => void
      ) => {
        next();
      }
    );

    this.app.use(
      async (
        req: http.IncomingMessage,
        res: http.ServerResponse,
        next: (err?: any) => void
      ) => {
        // count total requests
        this.requests++;

        // set headers
        res.setHeader("x-mock-openai-api", "true");

        // simulate latency
        await latency(this.latency, this.jitter);

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

    this.app.post(
      "/chat/completions",
      async (
        req: FastifyRequest<{ Body: ChatCompletionRequest }>,
        res: FastifyReply
      ): Promise<ChatCompletionResponse> => {
        try {
          const result = this.chat.completions(req.body);
          return result;
        } catch (err: any) {
          if (err.status) {
            res.statusCode = err.status;
            throw {
              error: err.error,
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
  fetch = (url: RequestInfo, init?: RequestInit): Promise<Response> => {
    return this.app
      .inject({
        method: init?.method as HTTPMethods,
        url: url.toString(),
        headers: init?.headers as http.IncomingHttpHeaders,
        payload: init?.body || {},
      })
      .then((response): Response => {
        const resp = new Response(response.payload, {
          status: response.statusCode,
          statusText: response.statusMessage,
          headers: response.headers as { [key: string]: string },
        });
        return resp;
      });
  };
}

/**
 * Simulate latency and jitter.
 * @param latency latency in ms
 * @param jitter jitter in ms
 * @returns void
 */
async function latency(latency: number, jitter: number) {
  // sleep for latency +- jitter
  const sleepTime = latency + Math.random() * jitter * 2 - jitter;
  await new Promise((resolve) => setTimeout(resolve, sleepTime));
}
