// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: BUSL-1.1

import {
  ModelID,
  ProviderID,
  ModelMetadata,
  BuiltinProvider,
  ClientType,
  BuiltinClientType,
  models as availableModels,
} from "./models";
import {
  Client,
  ClientOptions,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from "./clients/common";
import { OpenAIClient, AzureOpenAIClient } from "./clients/openai";
import { GoogleClient } from "./clients/google";
import { AnthropicClient } from "./clients/anthropic";

import log from "loglevel";

const builtinConstructors = {
  [BuiltinClientType.OpenAI]: OpenAIClient,
  [BuiltinClientType.AzureOpenAI]: AzureOpenAIClient,
  [BuiltinClientType.Google]: GoogleClient,
  [BuiltinClientType.Anthropic]: AnthropicClient,
};

let clientConstructors: Record<
  ClientType,
  new (key: string, model: ModelMetadata, options?: ClientOptions) => Client
> = { ...builtinConstructors };

export function registerClientType(
  clientType: ClientType,
  constructor: new (
    key: string,
    model: ModelMetadata,
    options?: ClientOptions
  ) => Client
): void {
  clientConstructors[clientType] = constructor;
}

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
    modelOptions?: Partial<Record<ModelID, ClientOptions>>
  ) {
    const models = options?.models || [];
    // populate missing builtin models
    for (const model of Object.values(availableModels)) {
      if (!models.find((m) => m.id === model.id)) {
        models.push(model);
      }
    }
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
        continue;
      }
      this.clients[model.id] = new clientConstructor(
        key,
        model,
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

  // late initialization of clients for models added at runtime
  async ensureClient(
    model: ModelMetadata,
    key?: string,
    modelOptions?: ClientOptions
  ): Promise<void> {
    if (this.clients[model.id] === undefined) {
      const provider = model.provider.id;
      const clientType = model.provider.clientType;
      const clientConstructor = clientConstructors[clientType];
      if (clientConstructor === undefined) {
        throw new Error(`Unknown provider: ${provider} for model: ${model.id}`);
      }
      this.clients[model.id] = new clientConstructor(
        key || "",
        model,
        modelOptions
      );
      this.clients[model.id].start();
    }
  }

  async createChatCompletion(
    request: ChatCompletionRequest
  ): Promise<ChatCompletionResponse> {
    let client = this.clients[request.model];
    if (client === undefined) {
      // try late initialization for the model
      throw new Error(`Unknown model: ${request.model}`);
    }
    return client.createChatCompletion(request);
  }
}
