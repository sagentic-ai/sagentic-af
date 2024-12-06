// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: MIT

import "openai/shims/node";
import { AnthropicClient as Client } from "../src/clients/anthropic";
import { ModelType } from "../src/models";
import { MessageRole } from "../src/thread";

const REAL_APIKEY = process.env.ANTHROPIC_API_KEY || "";

describe("Anthropic Client with real API", () => {
  let client: Client;

  beforeAll(() => {
    client = new Client(REAL_APIKEY, ModelType.CLAUDE3Haiku);
    client.start();
  });

  afterAll(() => {
    client.stop();
  });

  test.skip("Simple Request", async () => {
    const response = await client.createChatCompletion({
      model: ModelType.CLAUDE3Haiku,
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
