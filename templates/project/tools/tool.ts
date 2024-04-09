import { FunctionTool, Tool, Agent } from "{{SAGENTIC_PACKAGE}}";
import { z } from "zod";

/** Tool is a spicy function that can describe itself with OpenAI compatible JSON schema.*/
export const adder: Tool = new FunctionTool(
  /** name of the tool */

  "adder",
  /** description of the tool */
  "Adds two numbers together",

  /** Zod schema for parameters of the tool */
  z.object({ a: z.number(), b: z.number() }),

  /** Zod schema for return value of the tool */
  z.number(),

  /** Function for the tool to perform when called, notice that types of a and b are inferred */
  async (_agent: Agent, { a, b }) => {
    return a + b;
  }
);
