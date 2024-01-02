import { OneShotAgent, AgentOptions, ModelType } from "bazed";

// Define input type for the agent
interface HelloAgentOptions extends AgentOptions {
  person: string;
}

// We are going to use the OneShotAgent,
// it's the simplest agent type - it just makes a call to the LLM and returns the result.
// Notice the `export default` - this is how the agent class must be exported.
export default class HelloAgent extends OneShotAgent<
  HelloAgentOptions, // Define input type for the agent
  string // Define output type for the agent
> {
  // Set the model used by the agent
  model: ModelType = ModelType.GPT4Turbo;

  // Set the system prompt
  systemPrompt: string =
    "Your task is to explain why specific person is based. Speculate, limit your response to a sentence.";

  // Prepare the input for the LLM call
  input(): string {
    return `Why is ${this.options.person} based?`;
  }

  // Process the output from the LLM call
  output(answer: string): string {
    return answer;
  }
}
