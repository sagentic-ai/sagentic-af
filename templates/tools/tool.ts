import { FunctionTool, Tool, Agent } from "{{BAZED_PACKAGE}}";
import { z } from "zod";

/** Tool is a spicy function that can describe itself with OpenAI compatible JSON schema.*/
export const exampleTool: Tool = new FunctionTool(
  /** name of the tool */
  "exampleTool",

  /** description of the tool */
  "... description ...",

  /** Zod schema for parameters of the tool */
  z.object({}),

  /** Zod schema for return value of the tool */
  z.object({}),

  /** Function for the tool to perform when called, notice that types of a and b are inferred */
  async (_agent: Agent, {}) => {
    throw new Error("Method not implemented.");
  }
);
