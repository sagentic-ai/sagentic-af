// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: MIT

import "openai/shims/node";
import {
  AzureOpenAIClient as Client,
  parseDuration,
} from "../src/clients/openai";
import { ModelType } from "../src/models";
import { MessageRole } from "../src/thread";
import { MockOpenAIApi } from "./mock-openai/server";

const REAL_APIKEY = process.env.AZURE_OPENAI_API_KEY || "";
const REAL_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT || "";
const REAL_RESOURCE = process.env.AZURE_OPENAI_RESOURCE || "";
const BASEPATH = "http://localhost:4010";

describe("OpenAI Client with real API", () => {
  let client: Client;

  beforeAll(() => {
    client = new Client(REAL_APIKEY, ModelType.GPT35Turbo, {
      resource: REAL_RESOURCE,
      deployment: REAL_DEPLOYMENT,
    });
    client.start();
  });

  afterAll(() => {
    client.stop();
  });

  test.skip("Simple Request", async () => {
    const response = await client.createChatCompletion({
      model: ModelType.AZURE_GPT4o,
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
