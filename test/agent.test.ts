import "openai/shims/node";
import { Agent, AgentOptions, BaseAgent } from "../src/agent";
import { ClientMux } from "../src/client";
import { Session } from "../src/session";
import dotenv from "dotenv";
import { Thread } from "../src/thread";
import { ModelType } from "../src/models";
import { FunctionTool, Tool } from "../src/tool";
import { z } from "zod";
import zodToJsonSchema from "zod-to-json-schema";

dotenv.config();
const apiKey = process.env.OPENAI_API_KEY || "";

describe("Basic Agent", () => {
  let clients: ClientMux;
  let session: Session;

  beforeAll(() => {
    clients = new ClientMux(apiKey);
    clients.start();
    session = new Session(clients, {});
  });

  afterAll(() => {
    clients.stop();
  });

  class GreeterAgent extends BaseAgent<AgentOptions, void, string> {
    model: ModelType = ModelType.GPT35Turbo;
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
    clients = new ClientMux(apiKey);
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
    model: ModelType = ModelType.GPT35Turbo;
    systemPrompt: string = "You will be asked to add numbers.";
    thread: Thread;
    tools: Tool[] = [adder];

    constructor(session: Session, options: AdderAgentOptions) {
      super(session, { topic: "Add numbers.", ...options });
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

  test("Adding numbers with AI", async () => {
    const a = Math.floor(Math.random() * 1000000);
    const b = Math.floor(Math.random() * 1000000);
    const sum = a + b;

    const agent: AdderAgent = session.spawnAgent(AdderAgent, {
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

describe("Agent conserving tokens", () => {
  let clients: ClientMux;
  let session: Session;

  beforeAll(() => {
    clients = new ClientMux(apiKey);
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
    model: ModelType = ModelType.GPT4Turbo;
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
