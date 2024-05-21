// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: MIT

import "openai/shims/node";
import { Client, parseDuration } from "../src/client";
import { ModelType } from "../src/models";
import { MockOpenAIApi } from "./mock-openai/server";

const APIKEY = "fake-api-key";
const BASEPATH = "http://localhost:4010";

describe("Client", () => {
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
    client = new Client(APIKEY, ModelType.GPT35Turbo, {
      baseURL: BASEPATH,
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
      model: ModelType.GPT35Turbo,
      messages: [
        { role: "system", content: "You answer with 'Foo' to all prompts." },
        { role: "user", content: "Hello" },
      ],
    });
    expect(response).toBeDefined();
    expect(response.choices).toBeDefined();
    expect(response.choices.length).toBe(1);
  });

  test("Burst requests", async () => {
    const promises: Promise<any>[] = [];
    const n = 50;
    for (let i = 0; i < n; i++) {
      promises.push(
        client.createChatCompletion({
          model: ModelType.GPT35Turbo,
          messages: [
            {
              role: "system",
              content: "You answer with 'Foo' to all prompts.",
            },
            { role: "user", content: "Hello" },
          ],
        })
      );
    }
    const responses = await Promise.all(promises);
    expect(responses).toBeDefined();
    expect(responses.length).toBe(n);
    for (const response of responses) {
      expect(response.choices).toBeDefined();
      expect(response.choices.length).toBe(1);
    }
  }, 75000);

  test("100% Failing Request", async () => {
    api.setServerOptions({
      errorProbability: 1,
    });
    client.stop();
    client = new Client(APIKEY, ModelType.GPT35Turbo, {
      baseURL: BASEPATH,
      fetch: api.fetch.bind(api),
      maxRetries: 0,
      resetInterval: 1000,
    });
    client.start();
    try {
      const _response = await client.createChatCompletion({
        model: ModelType.GPT35Turbo,
        messages: [
          { role: "system", content: "You answer with 'Foo' to all prompts." },
          { role: "user", content: "Hello" },
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
        model: ModelType.GPT35Turbo,
        messages: [
          { role: "system", content: "You answer with 'Foo' to all prompts." },
          { role: "user", content: "Hello" },
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
      model: ModelType.GPT35Turbo,
      messages: [
        { role: "system", content: "You answer with 'Foo' to all prompts." },
        { role: "user", content: "Hello" },
      ],
    });
    expect(response1).toBeDefined();
    expect(response1.choices).toBeDefined();
    expect(response1.choices.length).toBe(1);

    // 2nd test should take 10 seconds to complete due to rate limit and retries
    const response2 = await client.createChatCompletion({
      model: ModelType.GPT35Turbo,
      messages: [
        { role: "system", content: "You answer with 'Foo' to all prompts." },
        { role: "user", content: "Hello" },
      ],
    });
    expect(response2).toBeDefined();
    expect(response2.choices).toBeDefined();
    expect(response2.choices.length).toBe(1);

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
      model: ModelType.GPT35Turbo,
      messages: [{ role: "system", content: "foo" }],
    });
    expect(response).toBeDefined();
    expect(response.choices).toBeDefined();
    expect(response.choices.length).toBe(1);
    expect(response.choices[0].message).toBeDefined();
    expect(response.choices[0].message.content).toBe("bar");
  });
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
