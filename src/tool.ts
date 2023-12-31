import { ChatCompletionTool } from "openai/resources/chat/completions";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { Agent } from "./agent";

export type ToolSpec = ChatCompletionTool;

export interface Tool {
  /** Name of the tool */
  name: string;

  /** Description of the tool */
  description: string;

  /** Invoke the tool.
   * @param args Arguments for the tool
   * @returns Return value of the tool
   * @throws Error if the arguments are invalid or not supported
   */
  invoke: (agent: Agent, args: any) => Promise<any>;

  /** Convert a tool to OpenAI compatible tool schema.
   * @returns OpenAI compatible JSON schema as JS object
   */
  describe: () => ToolSpec;
}

/** Tool is a spicy function that can describe itself with OpenAI compatible JSON schema.
 * @param name Name of the tool
 * @param description Description of the tool
 * @param args Zod schema for parameters of the tool
 * @param returns Zod schema for return value of the tool
 */
export class FunctionTool<Args, Returns> implements Tool {
  /** Name of the tool */
  name: string;
  /** Description of the tool */
  description: string;
  /** Zod schema for parameters of the tool */
  args: z.ZodType<Args>;
  /** Zod schema for return value of the tool */
  returns: z.ZodType<Returns>;

  /** Function for the tool to perform when called */
  func: (agent: Agent, args: Args) => Promise<Returns>;

  constructor(
    name: string,
    description: string,
    args: z.ZodType<Args>,
    returns: z.ZodType<Returns>,
    func: (agent: Agent, args: Args) => Promise<Returns>
  ) {
    this.name = name;
    this.description = description;
    this.args = args;
    this.returns = returns;
    this.func = func;
  }

  async invoke(agent: Agent, args: Args): Promise<Returns> {
    const validatedArgs = this.args.parse(args);
    const result = await this.func(agent, validatedArgs);
    const validatedResults = this.returns.parse(result);
    return validatedResults;
  }

  describe(): ToolSpec {
    const parameters = zodToJsonSchema(this.args);
    delete parameters.$schema;
    return {
      type: "function",
      function: {
        name: this.name,
        description: this.description,
        parameters,
      },
      // returns: zodToJsonSchema(tool.args), // not supported in the API yet?
    };
  }
}
