// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: MIT

import { Agent } from "../src/agent";
import { FunctionTool } from "../src/tool";
import { z } from "zod";

describe("Tool", () => {
  test("Create Tool", async () => {
    // input schema
    const AdderInput = z.object({
      a: z.number().describe("First number to add"),
      b: z.number().describe("Second number to add"),
    });

    // fake agent
    const agent = {
      metadata: {
        ID: "test",
      },
    } as unknown as Agent;

    // output schema
    const AdderOutput = z.number().describe("Sum of a and b");

    // tool definition
    const adder = new FunctionTool(
      "adder",
      "Adds two numbers",
      AdderInput,
      AdderOutput,
      async (agent, { a, b }) => {
        return a + b;
      }
    );

    // invoke the tool
    expect(adder).toBeDefined();
    expect(adder.name).toBe("adder");
    expect(adder.description).toBe("Adds two numbers");
    expect(await adder.invoke(agent, { a: 1, b: 2 })).toBe(3);

    // invoke the tool with invalid input
    await expect(async () => {
      await adder.invoke(agent, { a: 1, b: "2" } as unknown as z.infer<
        typeof AdderInput
      >);
    }).rejects.toThrow();

    // convert tool to spec
    const spec = adder.describe();
    expect(spec).toBeDefined();
    expect(spec).toStrictEqual({
      type: "function",
      function: {
        name: "adder",
        description: "Adds two numbers",
        parameters: {
          type: "object",
          properties: {
            a: {
              type: "number",
              description: "First number to add",
            },
            b: {
              type: "number",
              description: "Second number to add",
            },
          },
          required: ["a", "b"],
          additionalProperties: false,
        },
      },
    });
  });
});
