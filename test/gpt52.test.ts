// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: BUSL-1.1

import { OpenAIResponsesClient, OpenAIClient } from "../src/clients/openai";
import {
  BuiltinModel,
  BuiltinProvider,
  models,
  cards,
  ModelMetadata,
} from "../src/models";
import { MessageRole, Thread } from "../src/thread";
import { ReasoningEffort, Verbosity } from "../src/clients/common";
import { MockOpenAIApi } from "./mock-openai/server";
import { AgentOptions, BaseAgent } from "../src/agent";
import { ClientMux } from "../src/client_mux";
import { Session } from "../src/session";

const APIKEY = "fake-api-key";
const BASEPATH = "http://localhost:4010";

describe("GPT-5.2 Model Definitions", () => {
  test("GPT-5.2 enum values exist", () => {
    expect(BuiltinModel.GPT52).toBe("gpt-5.2");
  });

  test("Azure GPT-5.2 enum values exist", () => {
    expect(BuiltinModel.AZURE_GPT52).toBe("azure/gpt-5.2");
  });

  test("GPT-5.2 model cards have correct pricing", () => {
    expect(cards[BuiltinModel.GPT52].prompt).toBe(1.75);
    expect(cards[BuiltinModel.GPT52].completion).toBe(14);
  });

  test("GPT-5.2 model cards have correct context size", () => {
    expect(cards[BuiltinModel.GPT52].contextSize).toBe(400_000);
  });

  test("GPT-5.2 model cards have correct max output tokens", () => {
    expect(cards[BuiltinModel.GPT52].maxOutputTokens).toBe(128_000);
  });

  test("GPT-5.2 model cards have correct knowledge cutoff", () => {
    expect(cards[BuiltinModel.GPT52].knowledgeCutoff).toBe("2025-08-31");
  });

  test("GPT-5.2 model cards have correct batch queue limit (tier 5)", () => {
    expect(cards[BuiltinModel.GPT52].batchQueueLimit).toBe(15_000_000_000);
  });

  test("GPT-5.2 model cards support images", () => {
    expect(cards[BuiltinModel.GPT52].supportsImages).toBe(true);
  });

  test("GPT-5.2 model cards have checkpoints with dated version", () => {
    expect(cards[BuiltinModel.GPT52].checkpoint).toBe("gpt-5.2-2025-12-11");
  });

  test("GPT-5.2 models have metadata entries", () => {
    expect(models[BuiltinModel.GPT52]).toBeDefined();
    expect(models[BuiltinModel.AZURE_GPT52]).toBeDefined();
  });
});

describe("GPT-5.2 Reasoning + Verbosity Support", () => {
  test("GPT-5.2 supports reasoning", () => {
    expect(cards[BuiltinModel.GPT52].supportsReasoning).toBe(true);
  });

  test("GPT-5.2 defaults to 'medium' reasoning effort", () => {
    expect(cards[BuiltinModel.GPT52].defaultReasoningEffort).toBe("medium");
  });

  test("GPT-5.2 supports verbosity", () => {
    expect(cards[BuiltinModel.GPT52].supportsVerbosity).toBe(true);
  });
});

describe("GPT-5.2 Responses API Client Integration", () => {
  let client: OpenAIResponsesClient;
  let api: MockOpenAIApi;

  beforeEach(async () => {
    api = new MockOpenAIApi(
      {
        errorProbability: 0,
        latency: 50,
        jitter: 10,
      },
      {
        chat: {
          contextSize: 400_000,
          maxRPP: 100,
          maxTPP: 500_000,
          period: 5000,
        },
      }
    );
    await api.init();
  });

  afterEach(() => {
    if (client) client.stop();
    api.stop();
  });

  test("OpenAIResponsesClient can be created", () => {
    const model = {
      id: BuiltinModel.GPT52,
      provider: { ...models[BuiltinModel.GPT52].provider },
      card: { ...models[BuiltinModel.GPT52].card },
    };
    model.provider.url = BASEPATH;
    client = new OpenAIResponsesClient(APIKEY, model, {
      fetch: api.fetch.bind(api),
    });
    expect(client).toBeDefined();
  });

  test("GPT-5.2 simple request works via Responses API", async () => {
    const model = {
      id: BuiltinModel.GPT52,
      provider: { ...models[BuiltinModel.GPT52].provider },
      card: { ...models[BuiltinModel.GPT52].card },
    };
    model.provider.url = BASEPATH;
    client = new OpenAIResponsesClient(APIKEY, model, {
      fetch: api.fetch.bind(api),
    });
    client.start();

    const response = await client.createChatCompletion({
      model: BuiltinModel.GPT52,
      messages: [
        { role: MessageRole.System, content: "You are a helpful assistant." },
        { role: MessageRole.User, content: "Hello" },
      ],
    });

    expect(response).toBeDefined();
    expect(response.messages).toBeDefined();
    expect(response.messages.length).toBe(1);
  });

  test("GPT-5.2 with verbosity=low via Responses API", async () => {
    const model = {
      id: BuiltinModel.GPT52,
      provider: { ...models[BuiltinModel.GPT52].provider },
      card: { ...models[BuiltinModel.GPT52].card },
    };
    model.provider.url = BASEPATH;
    client = new OpenAIResponsesClient(APIKEY, model, {
      fetch: api.fetch.bind(api),
    });
    client.start();

    const response = await client.createChatCompletion({
      model: BuiltinModel.GPT52,
      options: { verbosity: Verbosity.LOW },
      messages: [{ role: MessageRole.User, content: "Explain gravity" }],
    });

    expect(response).toBeDefined();
    expect(response.messages).toBeDefined();
    expect(response.messages.length).toBe(1);
  });

  test("GPT-5.2 with reasoning_effort via Responses API", async () => {
    const model = {
      id: BuiltinModel.GPT52,
      provider: { ...models[BuiltinModel.GPT52].provider },
      card: { ...models[BuiltinModel.GPT52].card },
    };
    model.provider.url = BASEPATH;
    client = new OpenAIResponsesClient(APIKEY, model, {
      fetch: api.fetch.bind(api),
    });
    client.start();

    const response = await client.createChatCompletion({
      model: BuiltinModel.GPT52,
      options: { reasoning_effort: ReasoningEffort.MEDIUM },
      messages: [{ role: MessageRole.User, content: "What is 2+2?" }],
    });

    expect(response).toBeDefined();
    expect(response.messages).toBeDefined();
  });

  test("GPT-5.2 with both verbosity and reasoning_effort via Responses API", async () => {
    const model = {
      id: BuiltinModel.GPT52,
      provider: { ...models[BuiltinModel.GPT52].provider },
      card: { ...models[BuiltinModel.GPT52].card },
    };
    model.provider.url = BASEPATH;
    client = new OpenAIResponsesClient(APIKEY, model, {
      fetch: api.fetch.bind(api),
    });
    client.start();

    const response = await client.createChatCompletion({
      model: BuiltinModel.GPT52,
      options: {
        verbosity: Verbosity.LOW,
        reasoning_effort: ReasoningEffort.LOW,
      },
      messages: [{ role: MessageRole.User, content: "What is 5 * 7?" }],
    });

    expect(response).toBeDefined();
    expect(response.messages).toBeDefined();
    expect(response.messages.length).toBe(1);
  });
});

describe("GPT-5.2 Chat Completions API Client (Legacy)", () => {
  let client: OpenAIClient;
  let api: MockOpenAIApi;

  beforeEach(async () => {
    api = new MockOpenAIApi(
      {
        errorProbability: 0,
        latency: 50,
        jitter: 10,
      },
      {
        chat: {
          contextSize: 400_000,
          maxRPP: 100,
          maxTPP: 500_000,
          period: 5000,
        },
      }
    );
    await api.init();
  });

  afterEach(() => {
    if (client) client.stop();
    api.stop();
  });

  test("OpenAIClient (legacy Chat API) can be created", () => {
    const model = {
      id: BuiltinModel.GPT52,
      provider: { ...models[BuiltinModel.GPT52].provider },
      card: { ...models[BuiltinModel.GPT52].card },
    };
    model.provider.url = BASEPATH;
    client = new OpenAIClient(APIKEY, model, {
      fetch: api.fetch.bind(api),
    });
    expect(client).toBeDefined();
  });

  test("GPT-5.2 simple request works via Chat Completions API", async () => {
    const model = {
      id: BuiltinModel.GPT52,
      provider: { ...models[BuiltinModel.GPT52].provider },
      card: { ...models[BuiltinModel.GPT52].card },
    };
    model.provider.url = BASEPATH;
    client = new OpenAIClient(APIKEY, model, {
      fetch: api.fetch.bind(api),
    });
    client.start();

    const response = await client.createChatCompletion({
      model: BuiltinModel.GPT52,
      messages: [
        { role: MessageRole.System, content: "You are a helpful assistant." },
        { role: MessageRole.User, content: "Hello" },
      ],
    });

    expect(response).toBeDefined();
    expect(response.messages).toBeDefined();
    expect(response.messages.length).toBe(1);
  });
});

/**
 * GPT-5.2 Agent Verbosity Tests with Responses API
 */
describe("GPT-5.2 Agent Verbosity (Responses API)", () => {
  let api: MockOpenAIApi;
  let clients: ClientMux;
  let session: Session;
  let mockModel: ModelMetadata;

  interface VerbosityAgentOptions extends AgentOptions {
    prompt: string;
  }

  class VerbosityTestAgent extends BaseAgent<
    VerbosityAgentOptions,
    void,
    string
  > {
    systemPrompt: string =
      "You are a helpful assistant. Answer questions concisely.";
    thread: Thread;

    constructor(session: Session, options: VerbosityAgentOptions) {
      super(session, { topic: "Verbosity test", ...options });
      if (options.model) this.model = options.model;
      if (options.verbosity !== undefined) this.verbosity = options.verbosity;
      if (options.reasoning_effort !== undefined) {
        this.reasoning_effort = options.reasoning_effort;
      }
      this.thread = this.createThread();
    }

    async initialize(options: VerbosityAgentOptions): Promise<void> {
      this.thread = this.thread.appendUserMessage(options.prompt);
    }

    async step(): Promise<void> {
      this.thread = await this.advance(this.thread);
      this.stop();
    }

    async finalize(): Promise<string> {
      return this.thread.assistantResponse;
    }
  }

  beforeEach(async () => {
    api = new MockOpenAIApi(
      {
        errorProbability: 0,
        latency: 50,
        jitter: 10,
      },
      {
        chat: {
          contextSize: 400_000,
          maxRPP: 100,
          maxTPP: 500_000,
          period: 5000,
        },
      }
    );
    await api.init();

    mockModel = {
      id: "gpt-5.2-mock" as any,
      provider: { ...models[BuiltinModel.GPT52].provider, url: BASEPATH },
      card: { ...models[BuiltinModel.GPT52].card },
    };

    clients = new ClientMux(
      { [BuiltinProvider.OpenAI]: APIKEY },
      { models: [mockModel] }, // openaiApiType defaults to "responses"
      { ["gpt-5.2-mock"]: { fetch: api.fetch.bind(api) } }
    );
    clients.start();
    session = new Session(clients, {});
  });

  afterEach(() => {
    clients.stop();
    api.stop();
  });

  test("Agent verbosity property is set via options", () => {
    const agent = session.spawnAgent(VerbosityTestAgent, {
      model: mockModel,
      prompt: "test",
      verbosity: Verbosity.LOW,
    } as VerbosityAgentOptions);

    expect(agent.verbosity).toBe(Verbosity.LOW);
  });

  test("Agent modelInvocationOptions includes verbosity", () => {
    const agent = session.spawnAgent(VerbosityTestAgent, {
      model: mockModel,
      prompt: "test",
      verbosity: Verbosity.HIGH,
    } as VerbosityAgentOptions);

    const options = agent.modelInvocationOptions;
    expect(options).toBeDefined();
    expect(options?.verbosity).toBe(Verbosity.HIGH);
  });

  test("Agent with verbosity=low completes request", async () => {
    const agent = session.spawnAgent(VerbosityTestAgent, {
      model: mockModel,
      prompt: "What is 2 + 2?",
      verbosity: Verbosity.LOW,
    } as VerbosityAgentOptions);

    const result = await agent.run();
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
  });

  test("Agent with verbosity=high completes request", async () => {
    const agent = session.spawnAgent(VerbosityTestAgent, {
      model: mockModel,
      prompt: "Explain photosynthesis",
      verbosity: Verbosity.HIGH,
    } as VerbosityAgentOptions);

    const result = await agent.run();
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
  });

  test("Agent with both verbosity and reasoning_effort", async () => {
    const agent = session.spawnAgent(VerbosityTestAgent, {
      model: mockModel,
      prompt: "What is the square root of 144?",
      verbosity: Verbosity.LOW,
      reasoning_effort: ReasoningEffort.LOW,
    } as VerbosityAgentOptions);

    expect(agent.verbosity).toBe(Verbosity.LOW);
    expect(agent.reasoning_effort).toBe(ReasoningEffort.LOW);

    const options = agent.modelInvocationOptions;
    expect(options?.verbosity).toBe(Verbosity.LOW);
    expect(options?.reasoning_effort).toBe(ReasoningEffort.LOW);

    const result = await agent.run();
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
  });
});
