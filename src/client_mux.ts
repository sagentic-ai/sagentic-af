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
import { OpenAIClient, AzureOpenAIClient, OpenAIResponsesClient } from "./clients/openai";
import { GoogleClient } from "./clients/google";
import { AnthropicClient } from "./clients/anthropic";

import log from "loglevel";

/**
 * OpenAI API type for choosing between Responses API (new) and Chat Completions API (legacy)
 */
export type OpenAIApiType = "responses" | "chat";

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
  /**
   * OpenAI API type to use. Defaults to "responses" (new Responses API).
   * Set to "chat" to use the legacy Chat Completions API.
   * Note: verbosity parameter is only supported with the "responses" API type.
   */
  openaiApiType?: OpenAIApiType;
}

/**
 * ClientMux is a multiplexer for clients of multiple AI models.
 * @param keys Record<Provider, string> API keys for each provider
 * @param options ClientMuxOptions - includes openaiApiType to choose between Responses API (default) and Chat Completions API
 * @returns ClientMux
 * 
 * @example
 * // Use Responses API (default) - supports verbosity
 * const mux = new ClientMux({ openai: apiKey });
 * 
 * @example
 * // Use legacy Chat Completions API
 * const mux = new ClientMux({ openai: apiKey }, { openaiApiType: "chat" });
 */
export class ClientMux {
  private clients: Record<ModelID, Client>;
  private openaiApiType: OpenAIApiType;

  constructor(
    keys: Partial<Record<ProviderID, string>>,
    options?: ClientMuxOptions,
    modelOptions?: Partial<Record<ModelID, ClientOptions>>
  ) {
    this.openaiApiType = options?.openaiApiType ?? "responses";
    
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
      const key = keys[provider];
      if (key === undefined) {
        continue;
      }
      
      // Create the appropriate client based on provider and API type preference
      this.clients[model.id] = this.createClient(
        clientType,
        key,
        model,
        modelOptions?.[model.id]
      );
    }
  }

  /**
   * Create a client instance for a model
   */
  private createClient(
    clientType: ClientType,
    key: string,
    model: ModelMetadata,
    options?: ClientOptions
  ): Client {
    // For OpenAI provider, choose between Responses API and Chat Completions API
    if (clientType === BuiltinClientType.OpenAI) {
      if (this.openaiApiType === "responses") {
        return new OpenAIResponsesClient(key, model, options);
      } else {
        return new OpenAIClient(key, model, options);
      }
    }
    
    // For other providers, use the registered constructor
    const clientConstructor = clientConstructors[clientType];
    if (clientConstructor === undefined) {
      throw new Error(`Unknown provider: ${model.provider.id} for model: ${model.id}`);
    }
    return new clientConstructor(key, model, options);
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
      const clientType = model.provider.clientType;
      this.clients[model.id] = this.createClient(
        clientType,
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
  
  /**
   * Get the current OpenAI API type being used
   */
  getOpenAIApiType(): OpenAIApiType {
    return this.openaiApiType;
  }
}
