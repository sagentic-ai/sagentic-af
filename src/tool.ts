// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: BUSL-1.1

import { ChatCompletionTool } from "openai/resources/chat/completions";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { Agent, AgentOptions } from "./agent";
import moment from "moment";
import chalk from "chalk";
import { Constructor } from "./common";
import { OneShotAgent } from "./agents/one-shot";

import log from "loglevel";

declare global {
  var __PARAM_SCHEMAS__: Record<string, Record<string, z.ZodType>>;
  var __RETURN_SCHEMAS__: Record<string, Record<string, z.ZodType>>;
}

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
    const start = moment();
    const validatedArgs = this.args.parse(args);
    const result = await this.func(agent, validatedArgs);
    const validatedResults = this.returns.parse(result);
    const elapsed = moment().diff(start);
    log.info(
      chalk.yellow(agent.metadata.ID),
      chalk.green("tool"),
      this.name,
      chalk.gray(`(took ${moment.duration(elapsed).as("seconds").toFixed(2)}s)`)
    );
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
    };
  }
}

interface ToolInterface {
  name: string;
  description: string;
  args: z.ZodType<any>;
  returns: z.ZodType<any>;
}

interface ToolableAgentConstructor extends Constructor<Agent> {
  toolInterface?: ToolInterface;
  asTool?: Tool;
}

/** Toolable is a mixin for agent classes that can be used as tools. */
export interface Toolable {
  toolInterface?: ToolInterface;
  asTool?: Tool;
}

export type ToolLike = Tool | Toolable;

/** Convert a toolable to a tool.
 * @param toolLike Tool or toolable
 * @returns Tool
 * @throws Error if the toolable doesn't have a tool
 */
export const toTool = (toolLike: ToolLike): Tool => {
  if ("asTool" in toolLike) {
    if (toolLike.asTool) {
      return toolLike.asTool;
    } else {
      throw new Error("Toolable doesn't have a tool");
    }
  } else {
    return toolLike as Tool;
  }
};

/** Get the tool interface of a toolable.
 * @param toolLike
 * @returns Tool interface or undefined
 */
export const getToolInterface = (
  toolLike: ToolLike
): ToolInterface | undefined => {
  if ("toolInterface" in toolLike) {
    if (toolLike.toolInterface) {
      return toolLike.toolInterface;
    }
  }
  return undefined;
};

/** Decorator for agent classes that can be used as tools.
 * @param name Name of the tool
 * @param args Zod schema for parameters of the tool
 * @param returns Zod schema for return value of the tool
 */
export const isTool = <A, R>(
  name: string,
  description: string,
  args: z.ZodType<A>,
  returns: z.ZodType<R>
) =>
  function (constructor: Constructor<Agent>, _context: any) {
    const c = constructor as ToolableAgentConstructor;
    c.toolInterface = {
      name,
      description,
      args,
      returns,
    };
    c.asTool = new FunctionTool(
      name,
      description,
      args,
      returns,
      async (agent, args) => {
        const instance = agent.session.spawnAgent(
          constructor,
          args as AgentOptions
        );
        const result = await instance.run();
        return result;
      }
    );
  };

export function tool(
  description: string,
  schema: z.ZodType | undefined = undefined,
  returns: z.ZodType | undefined = undefined
) {
  return function tool<
    This extends Agent,
    Args extends [object] | [],
    Return,
    ClassName extends string = This extends { constructor: { name: infer N } }
      ? N extends string
        ? N
        : never
      : never,
  >(
    target: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<
      This,
      (this: This, ...args: Args) => Return
    >
  ) {
    context.addInitializer(function () {
      const toolSchema =
        schema ||
        globalThis.__PARAM_SCHEMAS__[this.constructor.name as ClassName][
          context.name.toString()
        ];
      const toolReturns =
        returns ||
        globalThis.__RETURN_SCHEMAS__[this.constructor.name as ClassName][
          context.name.toString()
        ];
      console.log(
        "init tool",
        context.name.toString(),
        description,
      );
      this.tools.push(
        new FunctionTool(
          context.name.toString(),
          description,
          toolSchema,
          toolReturns,
					async (agent, ...args) => {
						return target.apply(this, args as Args);
					},
        )
      );
    });
    return function (this: This, ...args: Args): Return {
      return target.apply(this, args);
    };
  };
};
