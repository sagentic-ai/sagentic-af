// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: MIT

import {
  ModelType,
  Provider,
  availableModels,
  models,
  pricing,
} from "./models";
import {
  Client,
  ClientOptions,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from "./clients/common";
import { OpenAIClient } from "./clients/openai";

interface ClientMuxOptions {
  models?: ModelType[];
}

/**
 * ClientMux is a multiplexer for clients of multiple AI models.
 * @param keys Record<Provider, string> API keys for each provider
 * @param options ClientOptions
 * @returns ClientMux
 */
export class ClientMux {
  private clients: Record<ModelType, Client>;

  constructor(
    keys: Record<Provider, string>,
    options?: ClientMuxOptions,
    modelOptions?: Record<ModelType, ClientOptions>
  ) {
    const modelClients = options?.models || availableModels;
    if (modelClients.length === 0) {
      throw new Error("Must provide at least one model");
    }
    this.clients = {} as Record<ModelType, Client>;
    for (const model of modelClients) {
      switch (models[model].provider) {
        case Provider.OpenAI:
          this.clients[model] = new OpenAIClient(
            keys[Provider.OpenAI],
            model,
            modelOptions?.[model]
          );
          break;
        default:
          throw new Error(
            `Unknown provider: ${models[model].provider} for model: ${model}`
          );
      }
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
    request: ChatCompletionRequest
  ): Promise<ChatCompletionResponse> {
    const model = request.model as ModelType;
    const client = this.clients[model];
    if (client === undefined) {
      throw new Error(`Unknown model: ${model}`);
    }
    return client.createChatCompletion(request);
  }
}
