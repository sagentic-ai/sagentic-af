// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: BUSL-1.1

//import "openai/shims/node";
import { Agent, AgentOptions, BaseAgent } from "../src/agent";
import { ClientMux } from "../src/client_mux";
import { Session } from "../src/session";
import dotenv from "dotenv";
import { Thread } from "../src/thread";
import { BuiltinModel, BuiltinProvider, ModelMetadata } from "../src/models";
import { FunctionTool, Tool } from "../src/tool";
import { ReasoningEffort, Verbosity } from "../src/clients/common";
import { z } from "zod";
import zodToJsonSchema from "zod-to-json-schema";

dotenv.config();
const openaiApiKey = process.env.OPENAI_API_KEY || "";
const googleApiKey = process.env.GOOGLE_API_KEY || "";
const anthropicApiKey = process.env.ANTHROPIC_API_KEY || "";

describe("Basic Agent", () => {
  let clients: ClientMux;
  let session: Session;

  beforeAll(() => {
    clients = new ClientMux({ [BuiltinProvider.OpenAI]: openaiApiKey });
    clients.start();
    session = new Session(clients, {});
  });

  afterAll(() => {
    clients.stop();
  });

  class GreeterAgent extends BaseAgent<AgentOptions, void, string> {
    model: BuiltinModel | ModelMetadata = BuiltinModel.GPT35Turbo;
    systemPrompt: string = "You always respond with 'World' to 'Hello'.";
    thread: Thread;

    constructor(session: Session) {
      super(session, { topic: "Greet the world." });
      this.thread = this.createThread();

      expect(() => {
        this.adopt(this.thread);
      }).toThrow("Thread already adopted");
    }

    async initialize(options: AgentOptions): Promise<void> {
      this.thread = this.thread.appendUserMessage("Hello");
    }

    async step(): Promise<void> {
      this.thread = await this.advance(this.thread);

      expect(() => {
        this.conclude();
      }).toThrow("Can't conclude an active Agent");

      this.stop();
    }

    async finalize(): Promise<string> {
      const response = this.thread.assistantResponse;
      return response;
    }
  }

  test("Greeting the world", async () => {
    expect(session.agentCount).toBe(0);

    const agent = session.spawnAgent(GreeterAgent);
    expect(agent).toBeDefined();
    expect(agent.parent).toBe(session);
    expect(agent.session).toBe(session);
    expect(agent.isActive).toBe(false);
    expect(session.agentCount).toBe(1);

    expect(agent.metadata.topic).toBe("Greet the world.");

    const randomThread = new Thread({} as Agent);

    expect(() => {
      agent.adopt(randomThread);
    }).toThrow("Thread already has a different parent");

    expect(() => {
      agent.abandon(randomThread);
    }).toThrow("Thread not adopted");

    expect(() => {
      agent.stop();
    }).toThrow("Agent is not active");

    const result = await agent.run();
    expect(result).toBe("World");
    expect(agent.isActive).toBe(false);
    expect(session.agentCount).toBe(0);
  });
});

describe("Agent with tools", () => {
  let clients: ClientMux;
  let session: Session;

  beforeAll(() => {
    clients = new ClientMux({
      [BuiltinProvider.OpenAI]: openaiApiKey,
      [BuiltinProvider.Google]: googleApiKey,
      [BuiltinProvider.Anthropic]: anthropicApiKey,
    });
    clients.start();
    session = new Session(clients, {});
  });

  afterAll(() => {
    clients.stop();
  });

  const AdderInput = z.object({
    a: z.number().describe("First number to be added"),
    b: z.number().describe("Second number to be added"),
  });
  const AdderOutput = z.number();

  let adderInvocation: { a: number; b: number; sum: number } | undefined =
    undefined;

  beforeEach(() => {
    adderInvocation = undefined;
  });

  const adder = new FunctionTool(
    "adder",
    "Adds two numbers",
    AdderInput,
    AdderOutput,
    async (agent, { a, b }) => {
      adderInvocation = { a, b, sum: a + b };
      return a + b;
    }
  );

  interface AdderAgentOptions extends AgentOptions {
    prompt: string;
  }

  class AdderAgent extends BaseAgent<AdderAgentOptions, void, string> {
    model: BuiltinModel | ModelMetadata = BuiltinModel.GPT35Turbo;
    systemPrompt: string =
      "You will be asked to add numbers. Use available tools to compute the answer. Do not send any messages other than tool calls and the final answer.";
    thread: Thread;
    tools: Tool[] = [adder];

    constructor(session: Session, options: AdderAgentOptions) {
      super(session, { topic: "Add numbers.", ...options });
      if (options.model) {
        this.model = options.model;
      }
      this.thread = this.createThread();
    }

    async initialize(options: AdderAgentOptions): Promise<void> {
      const { prompt } = options;
      this.thread = this.thread.appendUserMessage(prompt);
    }

    async step(): Promise<void> {
      this.thread = await this.advance(this.thread);
      this.stop();
    }

    async finalize(): Promise<string> {
      const response = this.thread.assistantResponse;
      return response;
    }
  }

  test.each([
    ["OpenAI", BuiltinModel.GPT35Turbo],
    // ["Google", BuiltinModel.GEMINI10],
    // ["Anthropic", BuiltinModel.CLAUDE3Haiku],
  ])("Adding numbers with %s", async (provider, model) => {
    const a = Math.floor(Math.random() * 1000000);
    const b = Math.floor(Math.random() * 1000000);
    const sum = a + b;

    const agent: AdderAgent = session.spawnAgent(AdderAgent, {
      model: model,
      prompt: `Add ${a} and ${b}`,
    } as AdderAgentOptions);

    expect(adderInvocation).not.toBeDefined();
    const result = await agent.run();

    expect(adderInvocation).toBeDefined();
    expect(adderInvocation?.a).toBe(a);
    expect(adderInvocation?.b).toBe(b);
    expect(adderInvocation?.sum).toBe(sum);

    expect(result.replaceAll(/[,.]/g, "")).toContain(`${sum}`);
  });
});

describe.skip("Agent conserving tokens", () => {
  let clients: ClientMux;
  let session: Session;

  beforeAll(() => {
    clients = new ClientMux({ [BuiltinProvider.OpenAI]: openaiApiKey });
    clients.start();
    session = new Session(clients, {});
  });

  afterAll(() => {
    session.abort();
    clients.stop();
  });

  const GetWordsInput = z.object({});
  const GetWordsOutput = z.string();

  let searchInvocations = 0;

  beforeEach(() => {
    searchInvocations = 0;
  });

  const results = [
    // random words
    "apple banana cherry Nike eggplant fig grapefruit Gucci honeydew",
    // more random words
    "ice cream Prada ketchup lemon mango Adidas orange pineapple",
    // even more random words
    "quince radish strawberry Superdry ugli fruit Balenciaga watermelon xigua",
  ];

  const goodWords = [
    "Nike",
    "Gucci",
    "Prada",
    "Adidas",
    "Superdry",
    "Balenciaga",
  ];

  const getWords = new FunctionTool(
    "get-words",
    "Looks up entities matching the query.",
    GetWordsInput,
    GetWordsOutput,
    async (_agent, _) => {
      const result = results[searchInvocations];
      if (!result)
        throw new Error("No more results, please don't call me again");
      searchInvocations++;
      return result;
    }
  );

  interface AdderAgentOptions extends AgentOptions {}

  const noteSchema = z.object({
    note: z.string().describe("Note to be preserved in context"),
  });

  const answerSchema = z.object({
    answer: z
      .array(z.string())
      .describe("List of words meeting the requirements"),
  });

  const responseSchema = z.union([noteSchema, answerSchema]);

  type Note = z.infer<typeof noteSchema>;
  type Answer = z.infer<typeof answerSchema>;
  type Response = z.infer<typeof responseSchema>;

  class TokenConservingAgent extends BaseAgent<
    AgentOptions,
    string[],
    string[]
  > {
    model: BuiltinModel | ModelMetadata = BuiltinModel.GPT4Turbo;
    systemPrompt: string = [
      "Your task is to fetch a list of words from a database using the `get-words` tool.",
      "I want you to return only the names of fashion brands. You must find all the words that meet this requirement.",
      "You have to call the tool until it says there are no more words available.",
      "Responses from the tool will be removed from the context, so you have to note down relevant information between tool invocations.",
      "Note only the relevant details and don't include any information that is not relevant to the task.",
      "Make sure to stick to your notes, they can be trusted, and not invent any new information.",
      "YOU MUST RESPOND WITH VALID JSON",
      "To make a note, respond adhering to this schema: ",
      JSON.stringify(zodToJsonSchema(noteSchema)),
      "When you are ready to return the final list of words, respond adhering to this schema: ",
      JSON.stringify(zodToJsonSchema(answerSchema)),
    ].join("\n");
    thread: Thread;
    tools: Tool[] = [getWords];
    expectsJSON: boolean = true;
    eatToolResults: boolean = true;

    constructor(session: Session, options: AdderAgentOptions) {
      super(session, { topic: "Use tools with context pruning.", ...options });
      this.thread = this.createThread();
    }

    async initialize(_options: AdderAgentOptions): Promise<string[]> {
      this.thread = this.thread.appendUserMessage("Please begin.");
      return [];
    }

    async step(_prevState: string[]): Promise<string[]> {
      this.thread = await this.advance(this.thread);
      const lastMessage = this.thread.assistantResponse;
      try {
        const json = JSON.parse(lastMessage);
        const resp: Response = responseSchema.parse(json);

        if ((resp as Note).note) {
          this.abandon(this.thread);
          this.thread = this.thread.appendUserMessage("Noted. Continue.");
          this.adopt(this.thread);
        } else if ((resp as Answer).answer) {
          this.stop();
          return (resp as Answer).answer;
        }
      } catch (e: any) {
        this.trace("Error:", e);
        this.trace("Last message:", lastMessage);
        this.abandon(this.thread);
        this.thread = this.thread.appendUserMessage(e.message);
        this.adopt(this.thread);
      }
      return [];
    }

    async finalize(finalState: string[]): Promise<string[]> {
      return finalState;
    }
  }

  test("Token conservation", async () => {
    const agent: TokenConservingAgent = session.spawnAgent(
      TokenConservingAgent,
      {} as TokenConservingAgent
    );

    expect(searchInvocations).toBe(0);
    const result = await agent.run();
    expect(searchInvocations).toBe(3);

    // expect not to find any tool use in the final transcript
    const messages = agent.thread.messages;
    for (const m of messages) {
      expect(m.tool_calls).not.toBeDefined();
      expect(m.tool_call_id).not.toBeDefined();
    }

    expect(result.sort()).toEqual(goodWords.sort());
  });
});

/**
 * GPT-5 Family Reasoning and Temperature Tests
 *
 * Tests reasoning_effort and temperature settings with GPT-5.1 and GPT-5 models.
 * These tests run against the real OpenAI API.
 *
 * Key behaviors:
 * - GPT-5.1 defaults to reasoning_effort="none", allows temperature
 * - GPT-5 defaults to reasoning_effort="medium", ignores temperature
 * - When reasoning_effort != "none", temperature is ignored
 */
describe("GPT-5 Family Reasoning and Temperature", () => {
  let clients: ClientMux;
  let session: Session;

  beforeAll(() => {
    clients = new ClientMux({ [BuiltinProvider.OpenAI]: openaiApiKey });
    clients.start();
  });

  beforeEach(() => {
    session = new Session(clients, {});
  });

  afterAll(() => {
    clients.stop();
  });

  interface ReasoningAgentOptions extends AgentOptions {
    prompt: string;
  }

  /**
   * Simple agent that answers a question with configurable reasoning/temperature/verbosity
   */
  class ReasoningTestAgent extends BaseAgent<
    ReasoningAgentOptions,
    void,
    string
  > {
    systemPrompt: string =
      "You are a helpful assistant. Answer concisely in one sentence.";
    thread: Thread;

    constructor(session: Session, options: ReasoningAgentOptions) {
      super(session, { topic: "Reasoning test", ...options });
      if (options.model) {
        this.model = options.model;
      }
      if (options.temperature !== undefined) {
        this.temperature = options.temperature;
      }
      if (options.reasoning_effort !== undefined) {
        this.reasoning_effort = options.reasoning_effort;
      }
      if (options.verbosity !== undefined) {
        this.verbosity = options.verbosity;
      }
      this.thread = this.createThread();
    }

    async initialize(options: ReasoningAgentOptions): Promise<void> {
      this.thread = this.thread.appendUserMessage(options.prompt);
    }

    async step(): Promise<void> {
      this.thread = await this.advance(this.thread);
      this.stop();
    }

    async finalize(): Promise<string> {
      return this.thread.assistantResponse;
    }
  }

  // GPT-5.1 tests - defaults to reasoning_effort="none"
  describe("GPT-5.1 (default reasoning: none)", () => {
    test("GPT-5.1 with default settings (no reasoning, allows temperature)", async () => {
      const agent = session.spawnAgent(ReasoningTestAgent, {
        model: BuiltinModel.GPT51,
        prompt: "What is 2 + 2?",
        temperature: 0.5,
      } as ReasoningAgentOptions);

      expect(agent.reasoning_effort).toBeUndefined(); // uses model default
      expect(agent.temperature).toBe(0.5);

      const result = await agent.run();
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
      expect(result.toLowerCase()).toContain("4");
    });

    test("GPT-5.1 with explicit reasoning_effort=none", async () => {
      const agent = session.spawnAgent(ReasoningTestAgent, {
        model: BuiltinModel.GPT51,
        prompt: "What is the capital of France?",
        reasoning_effort: ReasoningEffort.NONE,
        temperature: 0.7,
      } as ReasoningAgentOptions);

      expect(agent.reasoning_effort).toBe(ReasoningEffort.NONE);

      const result = await agent.run();
      expect(result).toBeDefined();
      expect(result.toLowerCase()).toContain("paris");
    });

    test("GPT-5.1 with reasoning_effort=low", async () => {
      const agent = session.spawnAgent(ReasoningTestAgent, {
        model: BuiltinModel.GPT51,
        prompt: "What is 15 * 17?",
        reasoning_effort: ReasoningEffort.LOW,
      } as ReasoningAgentOptions);

      expect(agent.reasoning_effort).toBe(ReasoningEffort.LOW);

      const result = await agent.run();
      expect(result).toBeDefined();
      expect(result).toContain("255");
    });

    test("GPT-5.1 with reasoning_effort=medium", async () => {
      const agent = session.spawnAgent(ReasoningTestAgent, {
        model: BuiltinModel.GPT51,
        prompt:
          "If a train travels 60 miles in 1 hour, how far does it travel in 2.5 hours?",
        reasoning_effort: ReasoningEffort.MEDIUM,
      } as ReasoningAgentOptions);

      expect(agent.reasoning_effort).toBe(ReasoningEffort.MEDIUM);

      const result = await agent.run();
      expect(result).toBeDefined();
      expect(result).toContain("150");
    });

    test("GPT-5.1 with reasoning_effort=high", async () => {
      const agent = session.spawnAgent(ReasoningTestAgent, {
        model: BuiltinModel.GPT51,
        prompt: "What is the sum of the first 10 prime numbers?",
        reasoning_effort: ReasoningEffort.HIGH,
      } as ReasoningAgentOptions);

      expect(agent.reasoning_effort).toBe(ReasoningEffort.HIGH);

      const result = await agent.run();
      expect(result).toBeDefined();
      // Sum of first 10 primes: 2+3+5+7+11+13+17+19+23+29 = 129
      expect(result).toContain("129");
    });
  });

  // GPT-5 tests - defaults to reasoning_effort="medium"
  // Note: GPT-5.1 Mini and Nano do not exist as of this writing
  describe("GPT-5 (default reasoning: medium)", () => {
    test("GPT-5 with default settings (medium reasoning)", async () => {
      const agent = session.spawnAgent(ReasoningTestAgent, {
        model: BuiltinModel.GPT5,
        prompt: "What is 7 * 8?",
      } as ReasoningAgentOptions);

      // GPT-5 uses medium reasoning by default (temperature ignored)
      const result = await agent.run();
      expect(result).toBeDefined();
      expect(result).toContain("56");
    });

    test("GPT-5 with reasoning_effort=low", async () => {
      // Note: GPT-5 does NOT support reasoning_effort="none"
      // It supports: "minimal", "low", "medium", "high"
      const agent = session.spawnAgent(ReasoningTestAgent, {
        model: BuiltinModel.GPT5,
        prompt: "What is the opposite of hot?",
        reasoning_effort: ReasoningEffort.LOW,
      } as ReasoningAgentOptions);

      const result = await agent.run();
      expect(result).toBeDefined();
      expect(result.toLowerCase()).toContain("cold");
    });

    test("GPT-5 with reasoning_effort=high", async () => {
      const agent = session.spawnAgent(ReasoningTestAgent, {
        model: BuiltinModel.GPT5,
        prompt:
          "If I have 3 apples and give away 1, then buy 5 more, how many do I have?",
        reasoning_effort: ReasoningEffort.HIGH,
      } as ReasoningAgentOptions);

      const result = await agent.run();
      expect(result).toBeDefined();
      expect(result).toContain("7");
    });
  });

  // GPT-5 Mini tests
  describe("GPT-5 Mini", () => {
    test("GPT-5 Mini with default settings", async () => {
      const agent = session.spawnAgent(ReasoningTestAgent, {
        model: BuiltinModel.GPT5Mini,
        prompt: "What planet is known as the Red Planet?",
      } as ReasoningAgentOptions);

      const result = await agent.run();
      expect(result).toBeDefined();
      expect(result.toLowerCase()).toContain("mars");
    });
  });

  // Test that agent properties are correctly set
  describe("Agent property verification", () => {
    test("reasoning_effort is set via options", () => {
      const agent = session.spawnAgent(ReasoningTestAgent, {
        model: BuiltinModel.GPT51,
        prompt: "test",
        reasoning_effort: ReasoningEffort.HIGH,
      } as ReasoningAgentOptions);

      expect(agent.reasoning_effort).toBe(ReasoningEffort.HIGH);
    });

    test("temperature is set via options", () => {
      const agent = session.spawnAgent(ReasoningTestAgent, {
        model: BuiltinModel.GPT51,
        prompt: "test",
        temperature: 0.9,
      } as ReasoningAgentOptions);

      expect(agent.temperature).toBe(0.9);
    });

    test("both reasoning_effort and temperature can be set", () => {
      const agent = session.spawnAgent(ReasoningTestAgent, {
        model: BuiltinModel.GPT51,
        prompt: "test",
        reasoning_effort: ReasoningEffort.NONE,
        temperature: 0.8,
      } as ReasoningAgentOptions);

      expect(agent.reasoning_effort).toBe(ReasoningEffort.NONE);
      expect(agent.temperature).toBe(0.8);
    });

    test("modelInvocationOptions includes reasoning_effort", () => {
      const agent = session.spawnAgent(ReasoningTestAgent, {
        model: BuiltinModel.GPT51,
        prompt: "test",
        reasoning_effort: ReasoningEffort.MEDIUM,
      } as ReasoningAgentOptions);

      const options = agent.modelInvocationOptions;
      expect(options).toBeDefined();
      expect(options?.reasoning_effort).toBe(ReasoningEffort.MEDIUM);
    });

    test("verbosity is set via options", () => {
      const agent = session.spawnAgent(ReasoningTestAgent, {
        model: BuiltinModel.GPT51,
        prompt: "test",
        verbosity: Verbosity.LOW,
      } as ReasoningAgentOptions);

      expect(agent.verbosity).toBe(Verbosity.LOW);
    });

    test("modelInvocationOptions includes verbosity", () => {
      const agent = session.spawnAgent(ReasoningTestAgent, {
        model: BuiltinModel.GPT51,
        prompt: "test",
        verbosity: Verbosity.HIGH,
      } as ReasoningAgentOptions);

      const options = agent.modelInvocationOptions;
      expect(options).toBeDefined();
      expect(options?.verbosity).toBe(Verbosity.HIGH);
    });
  });

  // GPT-5.1 Verbosity tests - tests verbosity parameter against real API
  // Note: These tests are skipped until the verbosity API parameter is publicly available
  describe.skip("GPT-5.1 Verbosity", () => {
    test("GPT-5.1 with verbosity=low produces concise response", async () => {
      const agent = session.spawnAgent(ReasoningTestAgent, {
        model: BuiltinModel.GPT51,
        prompt: "Explain what gravity is.",
        verbosity: Verbosity.LOW,
      } as ReasoningAgentOptions);

      expect(agent.verbosity).toBe(Verbosity.LOW);

      const result = await agent.run();
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
      // Low verbosity should mention gravity
      expect(result.toLowerCase()).toContain("gravity");
    });

    test("GPT-5.1 with verbosity=medium (default behavior)", async () => {
      const agent = session.spawnAgent(ReasoningTestAgent, {
        model: BuiltinModel.GPT51,
        prompt: "What is the speed of light?",
        verbosity: Verbosity.MEDIUM,
      } as ReasoningAgentOptions);

      expect(agent.verbosity).toBe(Verbosity.MEDIUM);

      const result = await agent.run();
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });

    test("GPT-5.1 with verbosity=high produces detailed response", async () => {
      const agent = session.spawnAgent(ReasoningTestAgent, {
        model: BuiltinModel.GPT51,
        prompt: "What causes seasons on Earth?",
        verbosity: Verbosity.HIGH,
      } as ReasoningAgentOptions);

      expect(agent.verbosity).toBe(Verbosity.HIGH);

      const result = await agent.run();
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
      // High verbosity response should mention relevant terms
      expect(
        result.toLowerCase().includes("tilt") ||
          result.toLowerCase().includes("axis") ||
          result.toLowerCase().includes("sun")
      ).toBe(true);
    });

    test("GPT-5.1 with both verbosity and reasoning_effort", async () => {
      const agent = session.spawnAgent(ReasoningTestAgent, {
        model: BuiltinModel.GPT51,
        prompt: "What is 23 * 47?",
        verbosity: Verbosity.LOW,
        reasoning_effort: ReasoningEffort.LOW,
      } as ReasoningAgentOptions);

      expect(agent.verbosity).toBe(Verbosity.LOW);
      expect(agent.reasoning_effort).toBe(ReasoningEffort.LOW);

      const result = await agent.run();
      expect(result).toBeDefined();
      // 23 * 47 = 1081
      expect(result).toContain("1081");
    });

    test("GPT-5.1 with verbosity=high and reasoning_effort=high", async () => {
      const agent = session.spawnAgent(ReasoningTestAgent, {
        model: BuiltinModel.GPT51,
        prompt:
          "If a car travels at 60 mph for 2 hours, then 40 mph for 1.5 hours, what is the total distance?",
        verbosity: Verbosity.HIGH,
        reasoning_effort: ReasoningEffort.HIGH,
      } as ReasoningAgentOptions);

      expect(agent.verbosity).toBe(Verbosity.HIGH);
      expect(agent.reasoning_effort).toBe(ReasoningEffort.HIGH);

      const result = await agent.run();
      expect(result).toBeDefined();
      // 60*2 + 40*1.5 = 120 + 60 = 180 miles
      expect(result).toContain("180");
    });
  });
});
