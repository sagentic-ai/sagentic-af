// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: BUSL-1.1

import { z } from "zod";
import { AgentOptions, BaseAgent, Agent } from "../agent";
import { jsonSchema, parseMultipleObjects } from "../common";
import { Session } from "../session";
import { Thread } from "../thread";

import log from "loglevel";

declare global {
  var __PARAM_SCHEMAS__: Record<string, Record<string, z.ZodType>>;
  var __RETURN_SCHEMAS__: Record<string, Record<string, z.ZodType>>;
}

type ReactionFunction<T, S> = (state: S, input: T) => S | Promise<S>;

interface SupportingWhen<StateType> {
  reactions: Reaction<any, StateType>[];
  rules: string[];
}

export interface Reaction<T, S> {
  type: string;
  match: z.ZodType<T>;
  then: ReactionFunction<T, S>;
}

/**
 * Decorator for defining reactions to structured messages.
 * @param rule
 * @param schema
 */
export const when = <S, T extends z.ZodRawShape>(
  rule: string,
  schema: z.ZodObject<T> | undefined = undefined
) => {
  return function when<
    This extends SupportingWhen<any>,
    Args extends [S, object],
    Return extends S | Promise<S>,
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
      const methodName = String(context.name);
      const cschema =
        schema ||
        globalThis.__PARAM_SCHEMAS__[this.constructor.name as ClassName][
          methodName
        ];
      const eschema = (cschema as z.ZodObject<T>).extend({
        type: z.literal(methodName),
      });

      this.reactions.push({
        type: methodName,
        match: eschema,
        then: (state: S, input: T) =>
          target.call(this, ...([state, input] as unknown as Args)),
      });
      this.rules.push(
        `When ${rule} answer adhering to the following schema:\n${jsonSchema(
          eschema
        )}`
      );
    });

    return target;
  };
};

/**
 * Decorator for defining the default reaction to unstructured messages.
 */
export const otherwise = <S, This, Args extends [S, string], Return extends S>(
  target: (this: This, ...args: Args) => Return,
  context: ClassMethodDecoratorContext<
    This,
    (this: This, ...args: Args) => Return
  >
) => {
  context.addInitializer(function () {
    (this as ReactiveAgent<any, S, any>).defaultReaction = (
      state: S,
      input: string
    ) => target.call(this, ...([state, input] as unknown as Args));
  });

  return target;
};

/**
 * ReactiveAgent is a base class for agents that are defined in terms of reactions to structured messages.
 *
 * @param OptionsType Options for the agent
 * @param StateType State of the agent
 * @param ReturnType Return type of the agent
 */
export class ReactiveAgent<
    OptionsType extends AgentOptions,
    StateType,
    ReturnType,
  >
  extends BaseAgent<OptionsType, StateType, ReturnType>
  implements SupportingWhen<StateType>
{
  thread: Thread;
  expectsJSON: boolean = true;

  reactions: Reaction<any, StateType>[] = [];
  defaultReaction: ((s: StateType, m: string) => StateType) | undefined =
    undefined;
  rules: string[] = ["ANSWER ONLY WITH JSON"];

  /** Create a new reactive agent.
   * @param session Session to use
   * @param options Options for the agent
   * */
  constructor(session: Session, options: OptionsType) {
    super(session, options);
    this.thread = this.createThread();
  }

  async initialize(options: OptionsType): Promise<StateType> {
    this.systemPrompt =
      this.systemPrompt + "\n\n# Output rules\n" + this.rules.join("\n");
    return await this.input(options);
  }

  async finalize(state: StateType): Promise<ReturnType> {
    return await this.output(state);
  }

  respond(
    message: string,
    files?: {
      images?: string[];
      imageOptions?: { detail: "auto" | "high" | "low" };
      videos?: string[];
      videoOptions?: { detail: "auto" | "high" | "low" };
      audios?: string[];
      audioOptions?: { detail: "auto" | "high" | "low" }; //TODO placeholder until OpenAI supports audio
    }
  ): void {
    this.abandon(this.thread);
    this.thread = this.thread.appendUserMessage(message);
    if (files) {
      if (files!.images && this.modelDetails?.supportsImages) {
        for (const image of files!.images) {
          this.thread = this.thread.appendUserImage(image, files!.imageOptions);
        }
      }
      if (files!.videos && this.modelDetails?.supportsVideo) {
        for (const video of files!.videos) {
          this.thread = this.thread.appendUserVideo(video, files!.videoOptions);
        }
      }
      if (files!.audios && this.modelDetails?.supportsAudio) {
        for (const audio of files!.audios) {
          this.thread = this.thread.appendUserAudio(audio, files!.audioOptions);
        }
      }
    }
    this.adopt(this.thread);
  }

  /**
   * Transform the input into the initial agent state.
   * @param options Options for the agent
   * @returns Initial state of the agent
   */
  async input(_options: OptionsType): Promise<StateType> {
    throw new Error("Method not implemented.");
  }

  /**
   * Transform the final agent state into the output.
   * @param state Final state of the agent
   * @returns Output of the agent
   */
  async output(_state: StateType): Promise<ReturnType> {
    throw new Error("Method not implemented.");
  }

  async step(state: StateType): Promise<StateType> {
    this.thread = await this.advance(this.thread);
    const lastMessage = this.thread.assistantResponse;
    let parsed: unknown[];
    let lastState = state;
    const expectedTypes = this.reactions.map((r) => r.type);
    try {
      parsed = parseMultipleObjects(lastMessage);
      let matched = false;
      for (const p of parsed) {
        for (const reaction of this.reactions) {
          const value = reaction.match.safeParse(p);
          if (value.success) {
            lastState = await reaction.then(lastState, value.data);
            matched = true;
            break;
          } else if (
            typeof (p as any).type === "string" &&
            reaction.type === (p as any).type
          ) {
            throw new Error(
              `You've sent "${reaction.type}" but it does not adhere to the schema, here is the error message: ${value.error}`
            );
          }
        }
      }
      if (!matched) {
        if (this.defaultReaction) {
          return await this.defaultReaction(state, lastMessage);
        } else {
          throw new Error(
            `You've sent a message but it does not adhere to any of the schemas. Please send a message that adheres to one of the accepted schemas.`
          );
        }
      }
      log.debug("step out");
      return lastState;
    } catch (e: any) {
      this.abandon(this.thread);
      this.thread = this.thread.appendUserMessage(e.message);
      this.adopt(this.thread);
      log.error("step error", e.message);
      return lastState;
    }
  }
}
