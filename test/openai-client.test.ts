// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: BUSL-1.1

//import "openai/shims/node";
import {
  OpenAIClient as Client,
  OpenAIResponsesClient,
  parseDuration,
} from "../src/clients/openai";
import { BuiltinModel, models } from "../src/models";
import { MessageRole } from "../src/thread";
import { MockOpenAIApi } from "./mock-openai/server";

const APIKEY = "fake-api-key";
const REAL_APIKEY = process.env.OPENAI_API_KEY || "";
const BASEPATH = "http://localhost:4010";

describe("OpenAI Client with mock API", () => {
  let client: Client;
  let api: MockOpenAIApi;

  const limitsPeriod = 5000;

  beforeEach(async () => {
    api = new MockOpenAIApi(
      {
        errorProbability: 0,
        latency: 50,
        jitter: 10,
      },
      {
        chat: {
          contextSize: 100,
          maxRPP: 100,
          maxTPP: 100000,
          period: limitsPeriod,
        },
      }
    );
    await api.init();
    const model = {
      id: "mock-open-ai",
      provider: { ...models[BuiltinModel.GPT35Turbo].provider },
      card: { ...models[BuiltinModel.GPT35Turbo].card },
    };
    model.provider.url = BASEPATH;
    client = new Client(APIKEY, model, {
      fetch: api.fetch.bind(api),
    });
    client.start();
  });

  afterEach(() => {
    client.stop();
    api.stop();
  });

  test("Create Client", () => {
    expect(client).toBeDefined();
  });

  test("Simple Request", async () => {
    const response = await client.createChatCompletion({
      model: BuiltinModel.GPT35Turbo,
      messages: [
        {
          role: MessageRole.System,
          content: "You answer with 'Foo' to all prompts.",
        },
        { role: MessageRole.User, content: "Hello" },
      ],
    });
    expect(response).toBeDefined();
    expect(response.messages).toBeDefined();
    expect(response.messages.length).toBe(1);
  });

  test("Burst requests", async () => {
    const promises: Promise<any>[] = [];
    const n = 50;
    for (let i = 0; i < n; i++) {
      promises.push(
        client.createChatCompletion({
          model: BuiltinModel.GPT35Turbo,
          messages: [
            {
              role: MessageRole.System,
              content: "You answer with 'Foo' to all prompts.",
            },
            { role: MessageRole.User, content: "Hello" },
          ],
        })
      );
    }
    const responses = await Promise.all(promises);
    expect(responses).toBeDefined();
    expect(responses.length).toBe(n);
    for (const response of responses) {
      expect(response.messages).toBeDefined();
      expect(response.messages.length).toBe(1);
    }
  }, 75000);

  test("100% Failing Request", async () => {
    api.setServerOptions({
      errorProbability: 1,
    });
    client.stop();
    client = new Client(APIKEY, models[BuiltinModel.GPT35Turbo], {
      baseURL: BASEPATH,
      fetch: api.fetch.bind(api),
      maxRetries: 0,
      resetInterval: 1000,
    });
    client.start();
    try {
      const _response = await client.createChatCompletion({
        model: BuiltinModel.GPT35Turbo,
        messages: [
          {
            role: MessageRole.System,
            content: "You answer with 'Foo' to all prompts.",
          },
          { role: MessageRole.User, content: "Hello" },
        ],
      });
      // should not reach here
      throw new Error("should not reach here");
    } catch (e: any) {
      expect(e).toBeDefined();
      expect(e.message).not.toBe("should not reach here");
    }
  }, 10000);

  test("Context size error", async () => {
    api.setAPIOptions({
      chat: {
        maxRPP: 100,
        maxTPP: 100000,
        period: limitsPeriod,
        contextSize: 1,
      },
    });
    try {
      const _response = await client.createChatCompletion({
        model: BuiltinModel.GPT35Turbo,
        messages: [
          {
            role: MessageRole.System,
            content: "You answer with 'Foo' to all prompts.",
          },
          { role: MessageRole.User, content: "Hello" },
        ],
      });
      // should not reach here
      throw new Error("should not reach here");
    } catch (e: any) {
      expect(e).toBeDefined();
      expect(e.message).not.toBe("should not reach here");
    }
  });

  test("Rate limit error", async () => {
    const period = 10000;
    api.setAPIOptions({
      chat: {
        contextSize: 100,
        maxTPP: 100000,
        maxRPP: 1,
        period: period,
      },
    });

    const startTimestamp = Date.now();

    // first request should be fine
    const response1 = await client.createChatCompletion({
      model: BuiltinModel.GPT35Turbo,
      messages: [
        {
          role: MessageRole.System,
          content: "You answer with 'Foo' to all prompts.",
        },
        { role: MessageRole.User, content: "Hello" },
      ],
    });
    expect(response1).toBeDefined();
    expect(response1.messages).toBeDefined();
    expect(response1.messages.length).toBe(1);

    // 2nd test should take 10 seconds to complete due to rate limit and retries
    const response2 = await client.createChatCompletion({
      model: BuiltinModel.GPT35Turbo,
      messages: [
        {
          role: MessageRole.System,
          content: "You answer with 'Foo' to all prompts.",
        },
        { role: MessageRole.User, content: "Hello" },
      ],
    });
    expect(response2).toBeDefined();
    expect(response2.messages).toBeDefined();
    expect(response2.messages.length).toBe(1);

    const endTimestamp = Date.now();
    expect(endTimestamp - startTimestamp).toBeGreaterThanOrEqual(period);
  }, 20000);

  test("Hardcoded response", async () => {
    api.setAPIOptions({
      chat: {
        dictionary: {
          foo: "bar",
        },
      },
    });
    const response = await client.createChatCompletion({
      model: BuiltinModel.GPT35Turbo,
      messages: [{ role: MessageRole.System, content: "foo" }],
    });
    expect(response).toBeDefined();
    expect(response.messages).toBeDefined();
    expect(response.messages.length).toBe(1);
    expect(response.messages[0].content).toBe("bar");
  });
});

describe.skip("OpenAI Client with real API", () => {
  let client: Client;

  beforeAll(() => {
    client = new Client(REAL_APIKEY, models[BuiltinModel.GPT41Mini]);
    client.start();
  });

  afterAll(() => {
    client.stop();
  });

  test("Simple Request", async () => {
    const response = await client.createChatCompletion({
      model: BuiltinModel.GPT41Mini,
      messages: [
        {
          role: MessageRole.System,
          content: "You answer with 'Foo' to all prompts.",
        },
        { role: MessageRole.User, content: "Hello" },
      ],
    });
    expect(response).toBeDefined();
    expect(response.messages).toBeDefined();
    expect(response.messages.length).toBe(1);
    console.log(response.messages[0].content);
  });
});

describe("OpenAI Client - Retry behavior (inflightTickets fix)", () => {
  let client: Client;
  let api: MockOpenAIApi;

  beforeEach(async () => {
    api = new MockOpenAIApi(
      {
        errorProbability: 0,
        latency: 10,
        jitter: 5,
      },
      {
        chat: {
          contextSize: 100,
          maxRPP: 100,
          maxTPP: 100000,
          period: 5000,
        },
      }
    );
    await api.init();
    const model = {
      id: "mock-open-ai",
      provider: { ...models[BuiltinModel.GPT35Turbo].provider },
      card: { ...models[BuiltinModel.GPT35Turbo].card },
    };
    model.provider.url = BASEPATH;
    client = new Client(APIKEY, model, {
      fetch: api.fetch.bind(api),
      maxRetries: 5,
    });
    client.start();
  });

  afterEach(() => {
    client.stop();
    api.stop();
  });

  test("Retry on server error removes ticket from inflight before re-queuing", async () => {
    // Configure mock to fail the first 2 requests with 500 error
    api.chat.setOptions({
      contextSize: 100,
      maxRPP: 100,
      maxTPP: 100000,
      period: 5000,
      failFirstN: 2,
    });
    api.chat.resetCounters();

    // Send a request that will fail twice then succeed
    const response = await client.createChatCompletion({
      model: BuiltinModel.GPT35Turbo,
      messages: [
        {
          role: MessageRole.System,
          content: "You answer with 'Foo' to all prompts.",
        },
        { role: MessageRole.User, content: "Hello" },
      ],
    });

    // Should eventually succeed after retries
    expect(response).toBeDefined();
    expect(response.messages).toBeDefined();
    expect(response.messages.length).toBe(1);

    // Verify mock was called 3 times (2 failures + 1 success)
    expect(api.chat.totalRequests).toBe(3);
  }, 10000);

  test("Multiple concurrent requests with server errors complete without getting stuck", async () => {
    // Configure mock to fail the first 3 requests with 500 error
    api.chat.setOptions({
      contextSize: 100,
      maxRPP: 100,
      maxTPP: 100000,
      period: 5000,
      failFirstN: 3,
    });
    api.chat.resetCounters();

    // Send 5 concurrent requests - if tickets get stuck in inflightTickets,
    // some of these would never complete
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(
        client.createChatCompletion({
          model: BuiltinModel.GPT35Turbo,
          messages: [
            {
              role: MessageRole.System,
              content: "You answer with 'Foo' to all prompts.",
            },
            { role: MessageRole.User, content: `Hello ${i}` },
          ],
        })
      );
    }

    // All should complete - if tickets get stuck, this would timeout
    const responses = await Promise.all(promises);

    expect(responses.length).toBe(5);
    for (const response of responses) {
      expect(response.messages).toBeDefined();
      expect(response.messages.length).toBe(1);
    }

    // Total requests should be >= 8 (3 failures + 5 successes)
    // Could be more due to retry interleaving
    expect(api.chat.totalRequests).toBeGreaterThanOrEqual(8);
  }, 15000);

  test("Rapid retry sequence does not leave orphaned tickets", async () => {
    // Configure mock to fail every other request (alternating pattern)
    // This tests the interleaving of retries with new requests
    api.chat.setOptions({
      contextSize: 100,
      maxRPP: 100,
      maxTPP: 100000,
      period: 5000,
      failFirstN: 5, // First 5 requests fail
    });
    api.chat.resetCounters();

    // Send requests one at a time with small delays
    const responses = [];
    for (let i = 0; i < 3; i++) {
      const response = await client.createChatCompletion({
        model: BuiltinModel.GPT35Turbo,
        messages: [
          {
            role: MessageRole.System,
            content: "You answer with 'Foo' to all prompts.",
          },
          { role: MessageRole.User, content: `Request ${i}` },
        ],
      });
      responses.push(response);
    }

    // All 3 should complete
    expect(responses.length).toBe(3);
    for (const response of responses) {
      expect(response.messages).toBeDefined();
      expect(response.messages.length).toBe(1);
    }
  }, 20000);
});

describe("OpenAI Client - Request timeout (Deno fetch bug defense)", () => {
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
          contextSize: 100,
          maxRPP: 100,
          maxTPP: 100000,
          period: 5000,
        },
      }
    );
    await api.init();
    const model = {
      id: "mock-open-ai",
      provider: { ...models[BuiltinModel.GPT35Turbo].provider },
      card: { ...models[BuiltinModel.GPT35Turbo].card },
    };
    model.provider.url = BASEPATH;
    // Use a very short timeout for testing
    client = new Client(APIKEY, model, {
      fetch: api.fetch.bind(api),
      maxRetries: 2,
      requestTimeout: 100, // 100ms timeout for testing
    });
    client.start();
  });

  afterEach(() => {
    client.stop();
    api.stop();
  });

  test("Request that exceeds timeout is retried", async () => {
    // Set latency higher than timeout
    api.setServerOptions({
      latency: 200, // 200ms > 100ms timeout
      jitter: 0,
    });

    // This should timeout and retry, but eventually fail after max retries
    try {
      await client.createChatCompletion({
        model: BuiltinModel.GPT35Turbo,
        messages: [
          {
            role: MessageRole.System,
            content: "You answer with 'Foo' to all prompts.",
          },
          { role: MessageRole.User, content: "Hello" },
        ],
      });
      // Should not reach here
      expect(true).toBe(false);
    } catch (e: any) {
      // Should fail after retries exhausted
      expect(e).toBeDefined();
      expect(e.message).toContain("timed out");
    }
  }, 10000);

  test("Request within timeout succeeds", async () => {
    // Set latency lower than timeout
    api.setServerOptions({
      latency: 20, // 20ms < 100ms timeout
      jitter: 0,
    });

    const response = await client.createChatCompletion({
      model: BuiltinModel.GPT35Turbo,
      messages: [
        {
          role: MessageRole.System,
          content: "You answer with 'Foo' to all prompts.",
        },
        { role: MessageRole.User, content: "Hello" },
      ],
    });

    expect(response).toBeDefined();
    expect(response.messages).toBeDefined();
    expect(response.messages.length).toBe(1);
  }, 5000);

  test("Timeout retry eventually succeeds if latency decreases", async () => {
    // Start with high latency (will timeout), but mock will reset after first request
    let requestCount = 0;
    const originalFetch = api.fetch.bind(api);

    // Wrap fetch to decrease latency after first timeout
    const customFetch = async (
      url: string | URL | globalThis.Request,
      init?: RequestInit
    ): Promise<Response> => {
      requestCount++;
      if (requestCount > 1) {
        // After first timeout, reduce latency so retry succeeds
        api.setServerOptions({ latency: 20, jitter: 0 });
      }
      return originalFetch(url, init);
    };

    // Recreate client with custom fetch
    client.stop();
    const model = {
      id: "mock-open-ai",
      provider: { ...models[BuiltinModel.GPT35Turbo].provider },
      card: { ...models[BuiltinModel.GPT35Turbo].card },
    };
    model.provider.url = BASEPATH;
    client = new Client(APIKEY, model, {
      fetch: customFetch,
      maxRetries: 3,
      requestTimeout: 100,
    });
    client.start();

    // Set high latency initially
    api.setServerOptions({ latency: 200, jitter: 0 });

    const response = await client.createChatCompletion({
      model: BuiltinModel.GPT35Turbo,
      messages: [
        {
          role: MessageRole.System,
          content: "You answer with 'Foo' to all prompts.",
        },
        { role: MessageRole.User, content: "Hello" },
      ],
    });

    // Should succeed after retry
    expect(response).toBeDefined();
    expect(response.messages).toBeDefined();
    expect(requestCount).toBeGreaterThan(1);
  }, 10000);
});

describe("OpenAI Responses API Client - Retry behavior (inflightTickets fix)", () => {
  let client: OpenAIResponsesClient;
  let api: MockOpenAIApi;

  beforeEach(async () => {
    api = new MockOpenAIApi(
      {
        errorProbability: 0,
        latency: 10,
        jitter: 5,
      },
      {
        chat: {
          contextSize: 100,
          maxRPP: 100,
          maxTPP: 100000,
          period: 5000,
        },
      }
    );
    await api.init();
    const model = {
      id: "mock-gpt-52",
      provider: { ...models[BuiltinModel.GPT41].provider },
      card: { ...models[BuiltinModel.GPT41].card },
    };
    model.provider.url = BASEPATH;
    client = new OpenAIResponsesClient(APIKEY, model, {
      fetch: api.fetch.bind(api),
      maxRetries: 5,
    });
    client.start();
  });

  afterEach(() => {
    client.stop();
    api.stop();
  });

  test("Responses API: Retry on server error removes ticket from inflight", async () => {
    // Configure mock to fail the first 2 requests with 500 error
    api.chat.setOptions({
      contextSize: 100,
      maxRPP: 100,
      maxTPP: 100000,
      period: 5000,
      failFirstN: 2,
    });
    api.chat.resetCounters();

    // Send a request that will fail twice then succeed
    const response = await client.createChatCompletion({
      model: "mock-gpt-52",
      messages: [
        {
          role: MessageRole.System,
          content: "You answer with 'Foo' to all prompts.",
        },
        { role: MessageRole.User, content: "Hello" },
      ],
    });

    // Should eventually succeed after retries
    expect(response).toBeDefined();
    expect(response.messages).toBeDefined();
    expect(response.messages.length).toBe(1);

    // Verify mock was called 3 times (2 failures + 1 success)
    expect(api.chat.totalRequests).toBe(3);
  }, 10000);

  test("Responses API: Multiple concurrent requests with server errors complete", async () => {
    // Configure mock to fail the first 3 requests with 500 error
    api.chat.setOptions({
      contextSize: 100,
      maxRPP: 100,
      maxTPP: 100000,
      period: 5000,
      failFirstN: 3,
    });
    api.chat.resetCounters();

    // Send 5 concurrent requests - if tickets get stuck in inflightTickets,
    // some of these would never complete
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(
        client.createChatCompletion({
          model: "mock-gpt-52",
          messages: [
            {
              role: MessageRole.System,
              content: "You answer with 'Foo' to all prompts.",
            },
            { role: MessageRole.User, content: `Hello ${i}` },
          ],
        })
      );
    }

    // All should complete - if tickets get stuck, this would timeout
    const responses = await Promise.all(promises);

    expect(responses.length).toBe(5);
    for (const response of responses) {
      expect(response.messages).toBeDefined();
      expect(response.messages.length).toBe(1);
    }

    // Total requests should be >= 8 (3 failures + 5 successes)
    expect(api.chat.totalRequests).toBeGreaterThanOrEqual(8);
  }, 15000);
});

describe("OpenAI Responses API Client - Request timeout", () => {
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
          contextSize: 100,
          maxRPP: 100,
          maxTPP: 100000,
          period: 5000,
        },
      }
    );
    await api.init();
    const model = {
      id: "mock-gpt-52",
      provider: { ...models[BuiltinModel.GPT41].provider },
      card: { ...models[BuiltinModel.GPT41].card },
    };
    model.provider.url = BASEPATH;
    // Use a very short timeout for testing
    client = new OpenAIResponsesClient(APIKEY, model, {
      fetch: api.fetch.bind(api),
      maxRetries: 2,
      requestTimeout: 100, // 100ms timeout for testing
    });
    client.start();
  });

  afterEach(() => {
    client.stop();
    api.stop();
  });

  test("Responses API: Request timeout triggers retry", async () => {
    // Set latency higher than timeout
    api.setServerOptions({
      latency: 200, // 200ms > 100ms timeout
      jitter: 0,
    });

    // This should timeout and retry, but eventually fail after max retries
    try {
      await client.createChatCompletion({
        model: "mock-gpt-52",
        messages: [
          {
            role: MessageRole.System,
            content: "You answer with 'Foo' to all prompts.",
          },
          { role: MessageRole.User, content: "Hello" },
        ],
      });
      // Should not reach here
      expect(true).toBe(false);
    } catch (e: any) {
      // Should fail after retries exhausted
      expect(e).toBeDefined();
      expect(e.message).toContain("timed out");
    }
  }, 10000);

  test("Responses API: Multiple concurrent requests with timeout recover correctly", async () => {
    let requestCount = 0;
    const originalFetch = api.fetch.bind(api);

    // Wrap fetch to decrease latency after first few requests
    const customFetch = async (
      url: string | URL | globalThis.Request,
      init?: RequestInit
    ): Promise<Response> => {
      requestCount++;
      if (requestCount > 2) {
        // After first timeouts, reduce latency so retries succeed
        api.setServerOptions({ latency: 20, jitter: 0 });
      }
      return originalFetch(url, init);
    };

    // Recreate client with custom fetch
    client.stop();
    const model = {
      id: "mock-gpt-52",
      provider: { ...models[BuiltinModel.GPT41].provider },
      card: { ...models[BuiltinModel.GPT41].card },
    };
    model.provider.url = BASEPATH;
    client = new OpenAIResponsesClient(APIKEY, model, {
      fetch: customFetch,
      maxRetries: 3,
      requestTimeout: 100,
    });
    client.start();

    // Set high latency initially
    api.setServerOptions({ latency: 200, jitter: 0 });

    // Send 3 concurrent requests
    const promises = [];
    for (let i = 0; i < 3; i++) {
      promises.push(
        client.createChatCompletion({
          model: "mock-gpt-52",
          messages: [
            {
              role: MessageRole.System,
              content: "You answer with 'Foo' to all prompts.",
            },
            { role: MessageRole.User, content: `Hello ${i}` },
          ],
        })
      );
    }

    // All should eventually complete after retries
    const responses = await Promise.all(promises);

    expect(responses.length).toBe(3);
    for (const response of responses) {
      expect(response.messages).toBeDefined();
    }
    // All 3 requests should have completed (the key is they didn't hang)
    expect(requestCount).toBeGreaterThanOrEqual(3);
  }, 15000);
});

describe("Client - parseDuration", () => {
  test("parseDuration - Valid duration format", () => {
    const duration = "6h10m0s0ms";
    const result = parseDuration(duration);
    expect(result).toBeDefined();
    expect(result.hours()).toBe(6);
    expect(result.minutes()).toBe(10);
    expect(result.seconds()).toBe(0);
    expect(result.milliseconds()).toBe(0);
  });

  test("parseDuration - Valid duration format with missing units", () => {
    const duration = "6m0s";
    const result = parseDuration(duration);
    expect(result).toBeDefined();
    expect(result.hours()).toBe(0);
    expect(result.minutes()).toBe(6);
    expect(result.seconds()).toBe(0);
    expect(result.milliseconds()).toBe(0);
  });

  test("parseDuration - Valid duration format with milliseconds", () => {
    const duration = "20s200ms";
    const result = parseDuration(duration);
    expect(result).toBeDefined();
    expect(result.hours()).toBe(0);
    expect(result.minutes()).toBe(0);
    expect(result.seconds()).toBe(20);
    expect(result.milliseconds()).toBe(200);
  });

  test("parseDuration - Invalid duration format", () => {
    const duration = "invalid";
    const result = parseDuration(duration);
    expect(result).toBeDefined();
    expect(result.hours()).toBe(0);
  });
});
