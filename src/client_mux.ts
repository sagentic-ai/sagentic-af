// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: MIT

import {
	ModelID,
  ModelMetadata,
  BuiltinProvider,
	ClientType,
  models as availableModels,
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
  [ClientType.OpenAI]: OpenAIClient,
  [ClientType.Google]: GoogleClient,
  [ClientType.Anthropic]: AnthropicClient,
};

interface ClientMuxOptions {
  models?: ModelMetadata[];
}

/**
 * ClientMux is a multiplexer for clients of multiple AI models.
 * @param keys Record<Provider, string> API keys for each provider
 * @param options ClientOptions
 * @returns ClientMux
 */
export class ClientMux {
  private clients: Record<ModelID, Client>;

  constructor(
    keys: Partial<Record<ProviderID, string>>,
    options?: ClientMuxOptions,
    modelOptions?: Record<ModelID, ClientOptions>
  ) {
    const models = options?.models || availableModels;
    if (models.length === 0) {
      throw new Error("Must provide at least one model");
    }
    this.clients = {} as Record<ModelID, Client>;
    for (const model of models) {
      const provider = model.provider.id;
			const clientType = model.provider.clientType;
      const clientConstructor = clientConstructors[clientType];
      if (clientConstructor === undefined) {
        throw new Error(`Unknown provider: ${provider} for model: ${model.id}`);
      }
      const key = keys[provider];
      if (key === undefined) {
        console.warn(
          `No API key provided for provider: ${provider} for model: ${model.id}`
        );
        continue;
      }
      this.clients[model.id] = new clientConstructor(
        key,
        model.id,
        modelOptions?.[model.id]
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
    const client = this.clients[request.model];
    if (client === undefined) {
      throw new Error(`Unknown model: ${request.model}`);
    }
    return client.createChatCompletion(request);
  }
}
