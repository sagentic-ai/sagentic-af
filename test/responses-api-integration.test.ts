// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: BUSL-1.1

/**
 * Integration tests for GPT-5.1 with the Responses API
 *
 * These tests verify that the framework facilities (ledger, threads, tools)
 * work correctly with the new Responses API while OpenAI manages conversation
 * state server-side.
 */

import "dotenv/config";
import { z } from "zod";
import {
  BuiltinModel,
  BuiltinProvider,
  models,
  ModelMetadata,
} from "../src/models";
import { MessageRole, Thread, ToolCall } from "../src/thread";
import { ReasoningEffort, Verbosity } from "../src/clients/common";
import { AgentOptions, BaseAgent } from "../src/agent";
import { ClientMux } from "../src/client_mux";
import { Session } from "../src/session";
import { FunctionTool } from "../src/tool";
import { Ledger, LedgerEntry, PCT } from "../src/ledger";

const openaiApiKey = process.env.OPENAI_API_KEY || "";

// Skip all tests if no API key
const describeWithKey = openaiApiKey ? describe : describe.skip;

/**
 * Tool invocation tracking for verification
 */
interface ToolInvocation {
  name: string;
  args: any;
  result: any;
  timestamp: Date;
}

const toolInvocations: ToolInvocation[] = [];

/**
 * Reset tool invocations before each test
 */
function resetToolInvocations() {
  toolInvocations.length = 0;
}

/**
 * Calculator tool - supports add, subtract, multiply, divide
 */
const CalculatorInput = z.object({
  operation: z
    .enum(["add", "subtract", "multiply", "divide"])
    .describe("The operation to perform"),
  a: z.number().describe("First operand"),
  b: z.number().describe("Second operand"),
});

const calculatorTool = new FunctionTool(
  "calculator",
  "Performs basic arithmetic operations: add, subtract, multiply, divide",
  CalculatorInput,
  z.number(),
  async (agent, { operation, a, b }) => {
    let result: number;
    switch (operation) {
      case "add":
        result = a + b;
        break;
      case "subtract":
        result = a - b;
        break;
      case "multiply":
        result = a * b;
        break;
      case "divide":
        if (b === 0) throw new Error("Division by zero");
        result = a / b;
        break;
    }
    toolInvocations.push({
      name: "calculator",
      args: { operation, a, b },
      result,
      timestamp: new Date(),
    });
    return result;
  }
);

/**
 * Data store tool - simulates a key-value database lookup
 */
const dataStore: Record<string, any> = {
  "user:alice": { name: "Alice", age: 30, role: "engineer" },
  "user:bob": { name: "Bob", age: 25, role: "designer" },
  "config:tax_rate": 0.15,
  "config:discount": 0.1,
  "product:widget": { name: "Widget", price: 99.99, stock: 42 },
  "product:gadget": { name: "Gadget", price: 149.99, stock: 17 },
};

const DataLookupInput = z.object({
  key: z.string().describe("The key to look up in the data store"),
});

const dataLookupTool = new FunctionTool(
  "data_lookup",
  "Looks up data from the store by key. Keys are in format 'category:name' like 'user:alice', 'config:tax_rate', 'product:widget'",
  DataLookupInput,
  z.any(),
  async (agent, { key }) => {
    const result = dataStore[key] ?? null;
    toolInvocations.push({
      name: "data_lookup",
      args: { key },
      result,
      timestamp: new Date(),
    });
    return result;
  }
);

/**
 * Memory tool - stores and retrieves information during the conversation
 */
const memory: Record<string, any> = {};

const MemoryStoreInput = z.object({
  key: z.string().describe("The key to store the value under"),
  value: z.any().describe("The value to store"),
});

const memoryStoreTool = new FunctionTool(
  "memory_store",
  "Stores a value in memory for later retrieval",
  MemoryStoreInput,
  z.boolean(),
  async (agent, { key, value }) => {
    memory[key] = value;
    toolInvocations.push({
      name: "memory_store",
      args: { key, value },
      result: true,
      timestamp: new Date(),
    });
    return true;
  }
);

const MemoryRetrieveInput = z.object({
  key: z.string().describe("The key to retrieve from memory"),
});

const memoryRetrieveTool = new FunctionTool(
  "memory_retrieve",
  "Retrieves a previously stored value from memory",
  MemoryRetrieveInput,
  z.any(),
  async (agent, { key }) => {
    const result = memory[key] ?? null;
    toolInvocations.push({
      name: "memory_retrieve",
      args: { key },
      result,
      timestamp: new Date(),
    });
    return result;
  }
);

/**
 * Multi-step task agent
 * Handles complex tasks that require multiple tool calls and reasoning
 */
interface TaskAgentOptions extends AgentOptions {
  task: string;
}

interface TaskAgentState {
  task: string;
  steps: number;
  maxSteps: number;
}

class MultiStepTaskAgent extends BaseAgent<
  TaskAgentOptions,
  TaskAgentState,
  string
> {
  systemPrompt: string = `You are an intelligent assistant that solves tasks step by step.
You have access to tools for calculations, data lookup, and memory storage.
Always think through problems methodically and use tools when needed.
When you have completed the task, provide a clear final answer.`;

  thread: Thread;

  constructor(session: Session, options: TaskAgentOptions) {
    super(session, { topic: "Multi-step task", ...options });
    if (options.model) {
      this.model = options.model;
    }
    if (options.reasoning_effort !== undefined) {
      this.reasoning_effort = options.reasoning_effort;
    }
    if (options.verbosity !== undefined) {
      this.verbosity = options.verbosity;
    }
    // Set up tools
    this.tools = [
      calculatorTool,
      dataLookupTool,
      memoryStoreTool,
      memoryRetrieveTool,
    ];
    this.thread = this.createThread();
  }

  async initialize(options: TaskAgentOptions): Promise<TaskAgentState> {
    this.thread = this.thread.appendUserMessage(options.task);
    return {
      task: options.task,
      steps: 0,
      maxSteps: 10, // Prevent infinite loops
    };
  }

  async step(state: TaskAgentState): Promise<TaskAgentState> {
    state.steps++;

    // Safety check for max steps
    if (state.steps >= state.maxSteps) {
      this.trace(`Max steps (${state.maxSteps}) reached, stopping`);
      this.stop();
      return state;
    }

    // Advance the thread (may involve tool calls)
    this.thread = await this.advance(this.thread);

    // Check if the assistant provided a final answer (no more tool calls pending)
    const lastMessage = this.thread.messages[this.thread.messages.length - 1];
    if (
      lastMessage.role === MessageRole.Assistant &&
      !lastMessage.tool_calls &&
      lastMessage.content
    ) {
      this.stop();
    }

    return state;
  }

  async finalize(state: TaskAgentState): Promise<string> {
    return this.thread.assistantResponse;
  }
}

describeWithKey("GPT-5.1 Responses API Integration", () => {
  let clients: ClientMux;
  let session: Session;

  beforeAll(() => {
    // Use Responses API (default)
    clients = new ClientMux({ [BuiltinProvider.OpenAI]: openaiApiKey });
    clients.start();
  });

  afterAll(() => {
    clients.stop();
  });

  beforeEach(() => {
    session = new Session(clients, {});
    resetToolInvocations();
    // Clear memory between tests
    Object.keys(memory).forEach((key) => delete memory[key]);
  });

  afterEach(() => {
    session.abort();
  });

  describe("Basic Responses API functionality", () => {
    test("Simple text response", async () => {
      const agent = session.spawnAgent(MultiStepTaskAgent, {
        model: BuiltinModel.GPT51,
        task: "What is 2 + 2? Just give me the number.",
        verbosity: Verbosity.LOW,
      } as TaskAgentOptions);

      const result = await agent.run();

      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
      expect(result).toMatch(/4/);
    }, 30000);

    test("Response with reasoning", async () => {
      const agent = session.spawnAgent(MultiStepTaskAgent, {
        model: BuiltinModel.GPT51,
        task: "If I have 3 apples and give away 1, then buy 5 more, how many do I have?",
        reasoning_effort: ReasoningEffort.MEDIUM,
        verbosity: Verbosity.LOW,
      } as TaskAgentOptions);

      const result = await agent.run();

      expect(result).toBeDefined();
      expect(result).toMatch(/7/);
    }, 30000);
  });

  describe("Tool calls with Responses API", () => {
    test("Single tool call - calculator", async () => {
      const agent = session.spawnAgent(MultiStepTaskAgent, {
        model: BuiltinModel.GPT51,
        task: "Use the calculator to multiply 17 by 23. Give me just the result.",
        verbosity: Verbosity.LOW,
      } as TaskAgentOptions);

      const result = await agent.run();

      // Verify tool was called
      expect(toolInvocations.length).toBeGreaterThanOrEqual(1);
      const calcInvocation = toolInvocations.find(
        (i) => i.name === "calculator"
      );
      expect(calcInvocation).toBeDefined();
      expect(calcInvocation?.args.operation).toBe("multiply");
      expect(calcInvocation?.result).toBe(391);

      // Verify result mentions the answer
      expect(result).toMatch(/391/);
    }, 30000);

    test("Data lookup tool", async () => {
      const agent = session.spawnAgent(MultiStepTaskAgent, {
        model: BuiltinModel.GPT51,
        task: "Look up the user 'alice' and tell me her role.",
        verbosity: Verbosity.LOW,
      } as TaskAgentOptions);

      const result = await agent.run();

      // Verify tool was called
      const lookupInvocation = toolInvocations.find(
        (i) => i.name === "data_lookup"
      );
      expect(lookupInvocation).toBeDefined();
      expect(lookupInvocation?.args.key).toBe("user:alice");
      expect(lookupInvocation?.result.role).toBe("engineer");

      // Verify result mentions engineer
      expect(result.toLowerCase()).toMatch(/engineer/);
    }, 30000);

    test("Multiple tool calls in sequence", async () => {
      const agent = session.spawnAgent(MultiStepTaskAgent, {
        model: BuiltinModel.GPT51,
        task: `I need to calculate the total cost with tax for a widget.
               First look up the widget price, then look up the tax rate,
               then calculate: price * (1 + tax_rate). Show your work.`,
        reasoning_effort: ReasoningEffort.LOW,
        verbosity: Verbosity.MEDIUM,
      } as TaskAgentOptions);

      const result = await agent.run();

      // Verify multiple tools were called
      expect(toolInvocations.length).toBeGreaterThanOrEqual(3);

      // Should have looked up widget
      const widgetLookup = toolInvocations.find(
        (i) => i.name === "data_lookup" && i.args.key === "product:widget"
      );
      expect(widgetLookup).toBeDefined();
      expect(widgetLookup?.result.price).toBe(99.99);

      // Should have looked up tax rate
      const taxLookup = toolInvocations.find(
        (i) => i.name === "data_lookup" && i.args.key === "config:tax_rate"
      );
      expect(taxLookup).toBeDefined();
      expect(taxLookup?.result).toBe(0.15);

      // Should have done calculation
      const calcInvocation = toolInvocations.find(
        (i) => i.name === "calculator"
      );
      expect(calcInvocation).toBeDefined();

      // Result should mention the final price (around 114.99)
      expect(result).toMatch(/114|115/);
    }, 60000);

    test("Memory store and retrieve", async () => {
      const agent = session.spawnAgent(MultiStepTaskAgent, {
        model: BuiltinModel.GPT51,
        task: `First, store the value 42 under the key "answer".
               Then retrieve it and tell me what you stored.`,
        verbosity: Verbosity.LOW,
      } as TaskAgentOptions);

      const result = await agent.run();

      // Verify store was called
      const storeInvocation = toolInvocations.find(
        (i) => i.name === "memory_store"
      );
      expect(storeInvocation).toBeDefined();
      expect(storeInvocation?.args.key).toBe("answer");
      expect(storeInvocation?.args.value).toBe(42);

      // Verify retrieve was called
      const retrieveInvocation = toolInvocations.find(
        (i) => i.name === "memory_retrieve"
      );
      expect(retrieveInvocation).toBeDefined();
      expect(retrieveInvocation?.result).toBe(42);

      // Result should mention 42
      expect(result).toMatch(/42/);
    }, 30000);
  });

  describe("Thread state verification", () => {
    test("Thread contains all messages", async () => {
      const agent = session.spawnAgent(MultiStepTaskAgent, {
        model: BuiltinModel.GPT51,
        task: "Use the calculator to add 10 and 20.",
        verbosity: Verbosity.LOW,
      } as TaskAgentOptions);

      await agent.run();

      // Access the thread
      const thread = agent["thread"];
      const messages = thread.messages;

      // Should have system, user, and at least one assistant message
      expect(messages.length).toBeGreaterThanOrEqual(3);

      // First message should be system
      expect(messages[0].role).toBe(MessageRole.System);

      // Second should be user
      expect(messages[1].role).toBe(MessageRole.User);
      expect(messages[1].content).toContain("calculator");

      // Should have assistant messages
      const assistantMessages = messages.filter(
        (m) => m.role === MessageRole.Assistant
      );
      expect(assistantMessages.length).toBeGreaterThanOrEqual(1);

      // If there was a tool call, verify tool response is in thread
      if (toolInvocations.length > 0) {
        const toolMessages = messages.filter(
          (m) => m.role === MessageRole.Tool
        );
        expect(toolMessages.length).toBeGreaterThanOrEqual(1);
      }
    }, 30000);

    test("Thread tracks tool calls correctly", async () => {
      const agent = session.spawnAgent(MultiStepTaskAgent, {
        model: BuiltinModel.GPT51,
        task: "Multiply 7 by 8 using the calculator.",
        verbosity: Verbosity.LOW,
      } as TaskAgentOptions);

      await agent.run();

      const thread = agent["thread"];
      const messages = thread.messages;

      // Find assistant message with tool calls
      const toolCallMessage = messages.find(
        (m) => m.role === MessageRole.Assistant && m.tool_calls
      );

      if (toolCallMessage) {
        expect(toolCallMessage.tool_calls).toBeDefined();
        expect(toolCallMessage.tool_calls!.length).toBeGreaterThanOrEqual(1);

        const toolCall = toolCallMessage.tool_calls![0];
        expect(toolCall.type).toBe("function");
        expect(toolCall.function.name).toBe("calculator");

        // Verify tool response follows
        const toolCallIdx = messages.indexOf(toolCallMessage);
        const toolResponse = messages[toolCallIdx + 1];
        expect(toolResponse).toBeDefined();
        expect(toolResponse.role).toBe(MessageRole.Tool);
      }
    }, 30000);
  });

  describe("Ledger verification", () => {
    test("Ledger tracks token usage", async () => {
      const ledger = session.getLedger();
      const initialTokens = ledger.tokens.total;

      const agent = session.spawnAgent(MultiStepTaskAgent, {
        model: BuiltinModel.GPT51,
        task: "What color is the sky?",
        verbosity: Verbosity.LOW,
      } as TaskAgentOptions);

      await agent.run();

      // Verify tokens were recorded
      expect(ledger.tokens.total).toBeGreaterThan(initialTokens);
      expect(ledger.tokens.prompt).toBeGreaterThan(0);
      expect(ledger.tokens.completion).toBeGreaterThan(0);
    }, 30000);

    test("Ledger tracks cost", async () => {
      const ledger = session.getLedger();

      const agent = session.spawnAgent(MultiStepTaskAgent, {
        model: BuiltinModel.GPT51,
        task: "Say 'hello world'",
        verbosity: Verbosity.LOW,
      } as TaskAgentOptions);

      await agent.run();

      // Verify cost was recorded
      expect(ledger.cost.total).toBeGreaterThan(0);
    }, 30000);

    test("Ledger records entries for each LLM call", async () => {
      const ledger = session.getLedger();
      const initialEntries = ledger.len;

      const agent = session.spawnAgent(MultiStepTaskAgent, {
        model: BuiltinModel.GPT51,
        task: "Add 5 and 3 using the calculator.",
        verbosity: Verbosity.LOW,
      } as TaskAgentOptions);

      await agent.run();

      // Should have at least one entry (possibly two if tool call happened)
      expect(ledger.len).toBeGreaterThan(initialEntries);

      // Verify entry structure
      const entries = ledger.entries;
      const newEntry = entries[entries.length - 1];
      expect(newEntry.model).toBe(BuiltinModel.GPT51);
      expect(newEntry.tokens.total).toBeGreaterThan(0);
      expect(newEntry.timing.hasEnded).toBe(true);
    }, 30000);

    test("Ledger tracks per-model usage", async () => {
      const ledger = session.getLedger();

      const agent = session.spawnAgent(MultiStepTaskAgent, {
        model: BuiltinModel.GPT51,
        task: "What is 1 + 1?",
        verbosity: Verbosity.LOW,
      } as TaskAgentOptions);

      await agent.run();

      // Verify per-model tracking
      const modelTokens = ledger.modelTokens[BuiltinModel.GPT51];
      expect(modelTokens).toBeDefined();
      expect(modelTokens.total).toBeGreaterThan(0);

      const modelCost = ledger.modelCost[BuiltinModel.GPT51];
      expect(modelCost).toBeDefined();
      expect(modelCost.total).toBeGreaterThan(0);
    }, 30000);

    test("Ledger emits events on new entries", async () => {
      const ledger = session.getLedger();
      const entriesReceived: LedgerEntry[] = [];

      ledger.on("entry", (entry) => {
        entriesReceived.push(entry);
      });

      const agent = session.spawnAgent(MultiStepTaskAgent, {
        model: BuiltinModel.GPT51,
        task: "Say 'test'",
        verbosity: Verbosity.LOW,
      } as TaskAgentOptions);

      await agent.run();

      // Should have received at least one entry event
      expect(entriesReceived.length).toBeGreaterThanOrEqual(1);
      expect(entriesReceived[0].model).toBe(BuiltinModel.GPT51);
    }, 30000);
  });

  describe("Complex multi-step scenarios", () => {
    test("Multi-step calculation with intermediate storage", async () => {
      const agent = session.spawnAgent(MultiStepTaskAgent, {
        model: BuiltinModel.GPT51,
        task: `Complete these steps:
               1. Look up the price of a gadget using data_lookup with key "product:gadget"
               2. Store that price in memory under 'base_price'
               3. Look up the discount rate using data_lookup with key "config:discount"
               4. Calculate the discounted price (base_price * (1 - discount))
               5. Store the final price in memory under 'final_price'
               6. Tell me the final discounted price`,
        reasoning_effort: ReasoningEffort.MEDIUM,
        verbosity: Verbosity.MEDIUM,
      } as TaskAgentOptions);

      const result = await agent.run();

      // Verify tool calls happened
      expect(toolInvocations.length).toBeGreaterThanOrEqual(3);

      // Verify data lookups happened (flexible on exact key format)
      const dataLookups = toolInvocations.filter(
        (i) => i.name === "data_lookup"
      );
      expect(dataLookups.length).toBeGreaterThanOrEqual(2);

      // Verify at least one lookup found the gadget
      const gadgetLookup = dataLookups.find(
        (i) => i.result?.price === 149.99 || i.args.key?.includes("gadget")
      );
      expect(gadgetLookup).toBeDefined();

      // Verify calculator was used
      const calcInvocations = toolInvocations.filter(
        (i) => i.name === "calculator"
      );
      expect(calcInvocations.length).toBeGreaterThanOrEqual(1);

      // Final price should be around 149.99 * (1 - 0.1) = 134.991
      // Accept a range of valid answers
      expect(result).toMatch(/13[0-9]|14[0-9]/);
    }, 90000);

    test("Error handling in tool calls", async () => {
      const agent = session.spawnAgent(MultiStepTaskAgent, {
        model: BuiltinModel.GPT51,
        task: "Try to divide 10 by 0 using the calculator. What happens?",
        verbosity: Verbosity.LOW,
      } as TaskAgentOptions);

      const result = await agent.run();

      // Agent should handle the error gracefully
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
      // Should mention error or division by zero
      expect(result.toLowerCase()).toMatch(
        /error|zero|cannot|undefined|infinity/
      );
    }, 30000);

    test("Non-existent data lookup", async () => {
      const agent = session.spawnAgent(MultiStepTaskAgent, {
        model: BuiltinModel.GPT51,
        task: "Look up 'user:charlie' and tell me what you find.",
        verbosity: Verbosity.LOW,
      } as TaskAgentOptions);

      const result = await agent.run();

      // Verify lookup was attempted
      const lookup = toolInvocations.find(
        (i) => i.name === "data_lookup" && i.args.key === "user:charlie"
      );
      expect(lookup).toBeDefined();
      expect(lookup?.result).toBeNull();

      // Agent should report not found (flexible pattern to handle various phrasings)
      // Normalize smart quotes to ASCII apostrophe (LLMs often return curly quotes)
      const normalizedResult = result.toLowerCase().replace(/[''ʼ]/g, "'");
      expect(normalizedResult).toMatch(
        /not found|null|doesn't exist|no data|unavailable|did not find|couldn't find|no.*stored|no.*record/
      );
    }, 30000);
  });

  describe("Verbosity effects", () => {
    test("Low verbosity produces concise response", async () => {
      const agent = session.spawnAgent(MultiStepTaskAgent, {
        model: BuiltinModel.GPT51,
        task: "What is the capital of France?",
        verbosity: Verbosity.LOW,
      } as TaskAgentOptions);

      const result = await agent.run();

      expect(result).toMatch(/paris/i);
      // Low verbosity should be relatively short
      expect(result.length).toBeLessThan(500);
    }, 30000);

    test("High verbosity produces detailed response", async () => {
      const agent = session.spawnAgent(MultiStepTaskAgent, {
        model: BuiltinModel.GPT51,
        task: "What is the capital of France?",
        verbosity: Verbosity.HIGH,
      } as TaskAgentOptions);

      const result = await agent.run();

      expect(result).toMatch(/paris/i);
      // High verbosity should include more detail
      // (though this is model-dependent, we just check it answered)
    }, 30000);
  });

  describe("Reasoning effort effects", () => {
    test("High reasoning effort for complex problem", async () => {
      const agent = session.spawnAgent(MultiStepTaskAgent, {
        model: BuiltinModel.GPT51,
        task: `A farmer has chickens and rabbits. 
               There are 35 heads and 94 legs total.
               How many chickens and how many rabbits?`,
        reasoning_effort: ReasoningEffort.HIGH,
        verbosity: Verbosity.LOW,
      } as TaskAgentOptions);

      const result = await agent.run();

      // Should correctly solve: c + r = 35, 2c + 4r = 94
      // Solution: 23 chickens, 12 rabbits
      expect(result).toMatch(/23.*chicken|chicken.*23/i);
      expect(result).toMatch(/12.*rabbit|rabbit.*12/i);
    }, 60000);
  });
});
