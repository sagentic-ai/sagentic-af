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
import { GoogleClient } from "./clients/google";
import { AnthropicClient } from "./clients/anthropic";

const clientConstructors = {
  [Provider.OpenAI]: OpenAIClient,
  [Provider.Google]: GoogleClient,
  [Provider.Anthropic]: AnthropicClient,
};

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
    keys: Partial<Record<Provider, string>>,
    options?: ClientMuxOptions,
    modelOptions?: Record<ModelType, ClientOptions>
  ) {
    const modelClients = options?.models || availableModels;
    if (modelClients.length === 0) {
      throw new Error("Must provide at least one model");
    }
    this.clients = {} as Record<ModelType, Client>;
    for (const model of modelClients) {
      const provider = models[model].provider;
      const clientConstructor = clientConstructors[provider];
      if (clientConstructor === undefined) {
        throw new Error(`Unknown provider: ${provider} for model: ${model}`);
      }
      const key = keys[provider];
      if (key === undefined) {
        console.warn(
          `No API key provided for provider: ${provider} for model: ${model}`
        );
        continue;
      }
      this.clients[model] = new clientConstructor(
        key,
        model,
        modelOptions?.[model]
      );
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
