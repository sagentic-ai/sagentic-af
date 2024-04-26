// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: MIT

import { ModelType, pricing } from "../models";
import {
  Client,
  GoogleClientOptions,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from "./common";
import { Message } from "../thread";

/** Google Client wrapper */
export class GoogleClient implements Client {
  constructor(
    googleAPIKey: string,
    model: ModelType,
    options?: GoogleClientOptions
  ) {}

  /**
   * Start the client. Must be called before using the client.
   * @returns void
   */
  start(): void {}

  /**
   * Stop the client. Must be called when done using the client.
   * @returns void
   */
  stop(): void {}

  /**
   * Create a chat completion.
   * @param request ChatCompletionCreateParamsNonStreaming
   * @returns Promise<ChatCompletion>
   */
  async createChatCompletion(
    request: ChatCompletionRequest
  ): Promise<ChatCompletionResponse> {
    return {} as ChatCompletionResponse;
  }
}
