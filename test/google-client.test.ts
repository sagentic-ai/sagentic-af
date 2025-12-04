// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: BUSL-1.1

//import "openai/shims/node";
import { GoogleClient as Client } from "../src/clients/google";
import { BuiltinModel, models } from "../src/models";
import { MessageRole } from "../src/thread";

const REAL_APIKEY = process.env.GOOGLE_API_KEY || "";

describe.skip("Google Client with real API", () => {
  let client: Client;

  beforeAll(() => {
    client = new Client(REAL_APIKEY, models[BuiltinModel.GEMINI10]);
    client.start();
  });

  afterAll(() => {
    client.stop();
  });

  test("Simple Request", async () => {
    const response = await client.createChatCompletion({
      model: BuiltinModel.GEMINI10,
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
