import { AgentOptions, OneShotAgent, ModelType } from "BAZED_PACKAGE";

export interface ExampleAgentOptions extends AgentOptions {
  /** agent options */
}

export interface ExampleAgentResult {
  /** agent result */
}

export default class ExampleAgent extends OneShotAgent<
  ExampleAgentOptions,
  ExampleAgentResult
> {
  model: ModelType = ModelType.GPT35Turbo;
  systemPrompt: string = "... add your system prompt here ...";

  async input(): Promise<string> {
    /* Transform input into a prompt for the LLM */
    throw new Error("Method not implemented.");
  }

  async output(answer: string): Promise<ExampleAgentResult> {
    /* Transform LLM response into agent result */
    throw new Error("Method not implemented.");
  }
}
