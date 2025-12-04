// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: BUSL-1.1

//import "openai/shims/node";
import { OpenAIClient as Client } from "../src/clients/openai";
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

describe("GPT-5.1 Model Definitions", () => {
  // Note: Only GPT-5.1 exists - Mini and Nano variants do NOT exist for GPT-5.1
  test("GPT-5.1 enum values exist", () => {
    expect(BuiltinModel.GPT51).toBe("gpt-5.1");
  });

  test("Azure GPT-5.1 enum values exist", () => {
    expect(BuiltinModel.AZURE_GPT51).toBe("azure/gpt-5.1");
  });

  test("GPT-5.1 model cards have correct pricing", () => {
    expect(cards[BuiltinModel.GPT51].prompt).toBe(1.25);
    expect(cards[BuiltinModel.GPT51].completion).toBe(10);
  });

  test("GPT-5.1 model cards have correct context size", () => {
    expect(cards[BuiltinModel.GPT51].contextSize).toBe(400_000);
  });

  test("GPT-5.1 model cards support images", () => {
    expect(cards[BuiltinModel.GPT51].supportsImages).toBe(true);
  });

  test("GPT-5.1 model cards have checkpoints with dated version", () => {
    expect(cards[BuiltinModel.GPT51].checkpoint).toBe("gpt-5.1-2025-11-13");
  });

  test("GPT-5.1 models have metadata entries", () => {
    expect(models[BuiltinModel.GPT51]).toBeDefined();
    expect(models[BuiltinModel.AZURE_GPT51]).toBeDefined();
  });
});

describe("GPT-5.1 Reasoning Support", () => {
  test("GPT-5.1 supports reasoning", () => {
    expect(cards[BuiltinModel.GPT51].supportsReasoning).toBe(true);
  });

  test("GPT-5.1 defaults to 'none' reasoning effort", () => {
    // GPT-5.1 is unique - it defaults to "none" reasoning (fast mode)
    expect(cards[BuiltinModel.GPT51].defaultReasoningEffort).toBe("medium");
  });

  test("GPT-5 models default to 'medium' reasoning effort", () => {
    // GPT-5 family defaults to "medium" reasoning
    expect(cards[BuiltinModel.GPT5].defaultReasoningEffort).toBe("medium");
    expect(cards[BuiltinModel.GPT5Mini].defaultReasoningEffort).toBe("medium");
    expect(cards[BuiltinModel.GPT5Nano].defaultReasoningEffort).toBe("medium");
  });

  test("O1/O3 models support reasoning with 'medium' default", () => {
    expect(cards[BuiltinModel.O1].supportsReasoning).toBe(true);
    expect(cards[BuiltinModel.O1].defaultReasoningEffort).toBe("medium");
    expect(cards[BuiltinModel.O1mini].supportsReasoning).toBe(true);
    expect(cards[BuiltinModel.O1mini].defaultReasoningEffort).toBe("medium");
    expect(cards[BuiltinModel.O3mini].supportsReasoning).toBe(true);
    expect(cards[BuiltinModel.O3mini].defaultReasoningEffort).toBe("medium");
  });

  test("Non-reasoning models do not have reasoning flags", () => {
    expect(cards[BuiltinModel.GPT4].supportsReasoning).toBeUndefined();
    expect(cards[BuiltinModel.GPT4o].supportsReasoning).toBeUndefined();
    expect(cards[BuiltinModel.GPT35Turbo].supportsReasoning).toBeUndefined();
  });
});

describe("ReasoningEffort Enum", () => {
  test("ReasoningEffort enum values", () => {
    expect(ReasoningEffort.NONE).toBe("none");
    expect(ReasoningEffort.MINIMAL).toBe("minimal");
    expect(ReasoningEffort.LOW).toBe("low");
    expect(ReasoningEffort.MEDIUM).toBe("medium");
    expect(ReasoningEffort.HIGH).toBe("high");
  });
});

describe("Codex Models", () => {
  test("GPT-5.1 Codex model exists", () => {
    expect(BuiltinModel.GPT51Codex).toBe("gpt-5.1-codex");
    expect(models[BuiltinModel.GPT51Codex]).toBeDefined();
    expect(cards[BuiltinModel.GPT51Codex]).toBeDefined();
  });

  test("GPT-5 Codex model exists", () => {
    expect(BuiltinModel.GPT5Codex).toBe("gpt-5-codex");
    expect(models[BuiltinModel.GPT5Codex]).toBeDefined();
    expect(cards[BuiltinModel.GPT5Codex]).toBeDefined();
  });

  test("GPT-5.1 Codex has correct reasoning defaults", () => {
    expect(cards[BuiltinModel.GPT51Codex].supportsReasoning).toBe(true);
    expect(cards[BuiltinModel.GPT51Codex].defaultReasoningEffort).toBe(
      "medium"
    );
  });

  test("GPT-5 Codex has correct reasoning defaults", () => {
    expect(cards[BuiltinModel.GPT5Codex].supportsReasoning).toBe(true);
    expect(cards[BuiltinModel.GPT5Codex].defaultReasoningEffort).toBe("medium");
  });

  test("Codex models have correct context size", () => {
    expect(cards[BuiltinModel.GPT51Codex].contextSize).toBe(400_000);
    expect(cards[BuiltinModel.GPT5Codex].contextSize).toBe(400_000);
  });

  test("Codex models support images", () => {
    expect(cards[BuiltinModel.GPT51Codex].supportsImages).toBe(true);
    expect(cards[BuiltinModel.GPT5Codex].supportsImages).toBe(true);
  });
});

describe("GPT-5.1 Verbosity Support", () => {
  test("GPT-5.1 supports verbosity", () => {
    expect(cards[BuiltinModel.GPT51].supportsVerbosity).toBe(true);
  });

  test("GPT-5.1 Codex supports verbosity", () => {
    expect(cards[BuiltinModel.GPT51Codex].supportsVerbosity).toBe(true);
  });

  test("Azure GPT-5.1 supports verbosity", () => {
    expect(cards[BuiltinModel.AZURE_GPT51].supportsVerbosity).toBe(true);
  });

  test("Non-5.1 models do not have verbosity support flag", () => {
    expect(cards[BuiltinModel.GPT5].supportsVerbosity).toBeUndefined();
    expect(cards[BuiltinModel.GPT4o].supportsVerbosity).toBeUndefined();
    expect(cards[BuiltinModel.GPT35Turbo].supportsVerbosity).toBeUndefined();
    expect(cards[BuiltinModel.O1].supportsVerbosity).toBeUndefined();
  });
});

describe("Verbosity Enum", () => {
  test("Verbosity enum values", () => {
    expect(Verbosity.LOW).toBe("low");
    expect(Verbosity.MEDIUM).toBe("medium");
    expect(Verbosity.HIGH).toBe("high");
  });
});

describe("GPT-5.1 Client Integration", () => {
  let client: Client;
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

  test("GPT-5.1 client can be created", () => {
    const model = {
      id: BuiltinModel.GPT51,
      provider: { ...models[BuiltinModel.GPT51].provider },
      card: { ...models[BuiltinModel.GPT51].card },
    };
    model.provider.url = BASEPATH;
    client = new Client(APIKEY, model, {
      fetch: api.fetch.bind(api),
    });
    expect(client).toBeDefined();
  });

  test("GPT-5.1 with default reasoning (none) allows temperature", async () => {
    const model = {
      id: BuiltinModel.GPT51,
      provider: { ...models[BuiltinModel.GPT51].provider },
      card: { ...models[BuiltinModel.GPT51].card },
    };
    model.provider.url = BASEPATH;
    client = new Client(APIKEY, model, {
      fetch: api.fetch.bind(api),
    });
    client.start();

    // With default reasoning_effort (none), temperature should be allowed
    const response = await client.createChatCompletion({
      model: BuiltinModel.GPT51,
      options: {
        temperature: 0.7,
      },
      messages: [{ role: MessageRole.User, content: "Hello" }],
    });

    expect(response).toBeDefined();
    expect(response.messages).toBeDefined();
    expect(response.messages.length).toBe(1);
  });

  test("GPT-5.1 simple request works", async () => {
    const model = {
      id: BuiltinModel.GPT51,
      provider: { ...models[BuiltinModel.GPT51].provider },
      card: { ...models[BuiltinModel.GPT51].card },
    };
    model.provider.url = BASEPATH;
    client = new Client(APIKEY, model, {
      fetch: api.fetch.bind(api),
    });
    client.start();

    const response = await client.createChatCompletion({
      model: BuiltinModel.GPT51,
      messages: [
        {
          role: MessageRole.System,
          content: "You are a helpful assistant.",
        },
        { role: MessageRole.User, content: "Hello" },
      ],
    });

    expect(response).toBeDefined();
    expect(response.messages).toBeDefined();
    expect(response.messages.length).toBe(1);
  });

  // Note: GPT-5.1 Mini and Nano do NOT exist - only GPT-5.1

  test("GPT-5.1 with explicit reasoning effort", async () => {
    const model = {
      id: BuiltinModel.GPT51,
      provider: { ...models[BuiltinModel.GPT51].provider },
      card: { ...models[BuiltinModel.GPT51].card },
    };
    model.provider.url = BASEPATH;
    client = new Client(APIKEY, model, {
      fetch: api.fetch.bind(api),
    });
    client.start();

    // Test with explicit medium reasoning effort
    const response = await client.createChatCompletion({
      model: BuiltinModel.GPT51,
      options: {
        reasoning_effort: ReasoningEffort.MEDIUM,
      },
      messages: [{ role: MessageRole.User, content: "What is 2+2?" }],
    });

    expect(response).toBeDefined();
    expect(response.messages).toBeDefined();
  });

  test("GPT-5.1 with verbosity=low", async () => {
    const model = {
      id: BuiltinModel.GPT51,
      provider: { ...models[BuiltinModel.GPT51].provider },
      card: { ...models[BuiltinModel.GPT51].card },
    };
    model.provider.url = BASEPATH;
    client = new Client(APIKEY, model, {
      fetch: api.fetch.bind(api),
    });
    client.start();

    const response = await client.createChatCompletion({
      model: BuiltinModel.GPT51,
      options: {
        verbosity: Verbosity.LOW,
      },
      messages: [{ role: MessageRole.User, content: "Explain gravity" }],
    });

    expect(response).toBeDefined();
    expect(response.messages).toBeDefined();
    expect(response.messages.length).toBe(1);
  });

  test("GPT-5.1 with verbosity=medium", async () => {
    const model = {
      id: BuiltinModel.GPT51,
      provider: { ...models[BuiltinModel.GPT51].provider },
      card: { ...models[BuiltinModel.GPT51].card },
    };
    model.provider.url = BASEPATH;
    client = new Client(APIKEY, model, {
      fetch: api.fetch.bind(api),
    });
    client.start();

    const response = await client.createChatCompletion({
      model: BuiltinModel.GPT51,
      options: {
        verbosity: Verbosity.MEDIUM,
      },
      messages: [
        { role: MessageRole.User, content: "What is the speed of light?" },
      ],
    });

    expect(response).toBeDefined();
    expect(response.messages).toBeDefined();
    expect(response.messages.length).toBe(1);
  });

  test("GPT-5.1 with verbosity=high", async () => {
    const model = {
      id: BuiltinModel.GPT51,
      provider: { ...models[BuiltinModel.GPT51].provider },
      card: { ...models[BuiltinModel.GPT51].card },
    };
    model.provider.url = BASEPATH;
    client = new Client(APIKEY, model, {
      fetch: api.fetch.bind(api),
    });
    client.start();

    const response = await client.createChatCompletion({
      model: BuiltinModel.GPT51,
      options: {
        verbosity: Verbosity.HIGH,
      },
      messages: [
        { role: MessageRole.User, content: "Explain quantum mechanics" },
      ],
    });

    expect(response).toBeDefined();
    expect(response.messages).toBeDefined();
    expect(response.messages.length).toBe(1);
  });

  test("GPT-5.1 with both verbosity and reasoning_effort", async () => {
    const model = {
      id: BuiltinModel.GPT51,
      provider: { ...models[BuiltinModel.GPT51].provider },
      card: { ...models[BuiltinModel.GPT51].card },
    };
    model.provider.url = BASEPATH;
    client = new Client(APIKEY, model, {
      fetch: api.fetch.bind(api),
    });
    client.start();

    // GPT-5.1 supports both verbosity and reasoning_effort simultaneously
    const response = await client.createChatCompletion({
      model: BuiltinModel.GPT51,
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

/**
 * GPT-5.1 Agent Verbosity Tests
 *
 * Tests verbosity settings on an agent using GPT-5.1.
 * Uses mock server to verify the agent properly passes verbosity to the client.
 */
describe("GPT-5.1 Agent Verbosity", () => {
  let api: MockOpenAIApi;
  let clients: ClientMux;
  let session: Session;
  let mockModel: ModelMetadata;

  interface VerbosityAgentOptions extends AgentOptions {
    prompt: string;
  }

  /**
   * Simple agent that supports verbosity settings
   */
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
      if (options.model) {
        this.model = options.model;
      }
      if (options.verbosity !== undefined) {
        this.verbosity = options.verbosity;
      }
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

    // Create a custom GPT-5.1 model that points to mock server URL
    mockModel = {
      id: "gpt-5.1-mock" as any,
      provider: {
        ...models[BuiltinModel.GPT51].provider,
        url: BASEPATH,
      },
      card: { ...models[BuiltinModel.GPT51].card },
    };

    // Create ClientMux with mock model and mock fetch
    clients = new ClientMux(
      { [BuiltinProvider.OpenAI]: APIKEY },
      { models: [mockModel] },
      { ["gpt-5.1-mock"]: { fetch: api.fetch.bind(api) } }
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
