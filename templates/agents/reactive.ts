import { AgentOptions, ReactiveAgent, ModelType, when } from "bazed";
import { z } from "zod";

export interface ExampleAgentOptions extends AgentOptions {
  /** agent options */
}

export interface ExampleAgentState {
  /** agent state */
}

export interface ExampleAgentResult {
  /** agent result */
}

export default class ExampleAgent extends ReactiveAgent<
  ExampleAgentOptions,
  ExampleAgentState,
  ExampleAgentResult
> {
  model: ModelType = ModelType.GPT35Turbo;
  systemPrompt: string = "... add your system prompt here ...";

  async input(_options: ExampleAgent): Promise<ExampleAgentState> {
    /* Transform input into the initial state */
    throw new Error("Method not implemented.");
  }

  @when("you want to cause a reaction", z.object({}))
  async reaction(
    _state: ExampleAgentState,
    _input: object
  ): Promise<ExampleAgentState> {
    /* Transform the state based on the reaction */
    throw new Error("Method not implemented.");
  }

  async output(_state: ExampleAgentState): Promise<ExampleAgentResult> {
    /* Transform the final state into the agent result */
    throw new Error("Method not implemented.");
  }
}
