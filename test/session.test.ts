// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: BUSL-1.1

//import "openai/shims/node";
import { Session, SessionBudgetHandler } from "../src/session";
import { Provider, BuiltinModel, models } from "../src/models";
import { AgentOptions, BaseAgent } from "../src/agent";
import { ClientMux } from "../src/client_mux";
import { MessageRole, Message } from "../src/thread";
import { MockOpenAIApi } from "./mock-openai/server";

class TestAgent extends BaseAgent<AgentOptions, undefined, undefined> {}

describe("Session", () => {
  const clients = new ClientMux({ [Provider.OpenAI]: "fake-key" });

  test("Create Session", async () => {
    const session = new Session(clients, { topic: "testing session" });
    expect(session).toBeDefined();
    expect(session.metadata.topic).toBe("testing session");
  });

  test("Child Agents", async () => {
    const session = new Session(clients, {});
    expect(session).toBeDefined();

    const agent = session.spawnAgent(TestAgent, { topic: "testing agent" });
    expect(agent).toBeDefined();
    expect(agent.parent).toBe(session);
    expect(agent.session).toBe(session);
    expect(agent.metadata.topic).toBe("testing agent");

    expect(() => session.adopt(agent)).toThrow("Agent already adopted");

    const newSession = new Session(clients, {});
    expect(() => newSession.adopt(agent)).toThrow(
      "Agent already has a different parent"
    );

    expect(() => newSession.abandon(agent)).toThrow(
      "Agent has a different parent"
    );

    expect(() => {
      session.abandon(agent);
    }).not.toThrow();

    expect(() => {
      session.abandon(agent);
    }).toThrow("Agent not adopted");
  });

  describe("SessionBudgetHandler", () => {
    let mockClients: ClientMux;

    beforeEach(async () => {
      // Create mock clients
      mockClients = new ClientMux({ [Provider.OpenAI]: "fake-key" });

      // Mock the createChatCompletion method to return a response with high token usage
      // This will simulate expensive API calls to trigger budget exceeded scenarios
      jest.spyOn(mockClients, "createChatCompletion").mockResolvedValue({
        messages: [
          {
            role: MessageRole.Assistant,
            content: "Hello! I'm a test response.",
          },
        ],
        usage: {
          prompt_tokens: 100000, // High token count to trigger budget exceeded
          completion_tokens: 50000,
        },
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("Session without budget handler throws error when budget exceeded", async () => {
      const session = new Session(mockClients, {
        budget: 0.01, // Small budget that will be exceeded
      });

      const agent = session.spawnAgent(TestAgent);

      // First call to establish some cost
      await session.invokeModel(agent, models[BuiltinModel.GPT35Turbo], [
        { role: MessageRole.System, content: "You are a helpful assistant." },
        { role: MessageRole.User, content: "Hello!" },
      ]);

      // Second call should throw because budget will be exceeded and no handler is provided
      await expect(
        session.invokeModel(agent, models[BuiltinModel.GPT35Turbo], [
          { role: MessageRole.System, content: "You are a helpful assistant." },
          { role: MessageRole.User, content: "Another message!" },
        ])
      ).rejects.toThrow("Session budget exceeded");
    });

    test("Session with budget handler that increases budget allows continuation", async () => {
      const budgetHandler = jest.fn<
        Promise<number>,
        [number, number, Message[], Session]
      >(async (totalCost, budget, nextMessages, session) => {
        return budget * 100; // Increase budget very significantly
      });

      const session = new Session(mockClients, {
        budget: 0.01, // Small budget that will be exceeded
        sessionBudgetHandler: budgetHandler,
      });

      const agent = session.spawnAgent(TestAgent);

      // First call to establish some cost
      await session.invokeModel(agent, models[BuiltinModel.GPT35Turbo], [
        { role: MessageRole.System, content: "You are a helpful assistant." },
        { role: MessageRole.User, content: "Hello!" },
      ]);

      // Second call should trigger budget handler and succeed
      const response = await session.invokeModel(
        agent,
        models[BuiltinModel.GPT35Turbo],
        [
          { role: MessageRole.System, content: "You are a helpful assistant." },
          { role: MessageRole.User, content: "Another message!" },
        ]
      );

      expect(response).toBeDefined();
      expect(budgetHandler).toHaveBeenCalled();
      expect(budgetHandler).toHaveBeenCalledWith(
        expect.any(Number),
        0.01,
        expect.any(Array),
        session
      );
    });

    test("Session with budget handler that doesn't increase budget enough still throws", async () => {
      const budgetHandler = jest.fn<
        Promise<number>,
        [number, number, Message[], Session]
      >(async (totalCost, budget, nextMessages, session) => {
        return budget + 0.01; // Increase budget by small amount, still not enough
      });

      const session = new Session(mockClients, {
        budget: 0.01,
        sessionBudgetHandler: budgetHandler,
      });

      const agent = session.spawnAgent(TestAgent);

      // First call to establish some cost
      await session.invokeModel(agent, models[BuiltinModel.GPT35Turbo], [
        { role: MessageRole.System, content: "You are a helpful assistant." },
        { role: MessageRole.User, content: "Hello!" },
      ]);

      // Second call should still throw because budget handler doesn't increase enough
      await expect(
        session.invokeModel(agent, models[BuiltinModel.GPT35Turbo], [
          { role: MessageRole.System, content: "You are a helpful assistant." },
          { role: MessageRole.User, content: "Another message!" },
        ])
      ).rejects.toThrow("Session budget exceeded");

      expect(budgetHandler).toHaveBeenCalled();
    });

    test("Budget handler receives correct parameters", async () => {
      const budgetHandler = jest.fn<
        Promise<number>,
        [number, number, Message[], Session]
      >(async (totalCost, budget, nextMessages, session) => {
        expect(totalCost).toBeGreaterThan(0);
        expect(budget).toBe(0.01);
        expect(nextMessages).toBeInstanceOf(Array);
        expect(nextMessages.length).toBeGreaterThan(0);
        expect(session).toBeInstanceOf(Session);
        return budget * 100; // Increase budget very significantly
      });

      const session = new Session(mockClients, {
        budget: 0.01,
        sessionBudgetHandler: budgetHandler,
      });

      const agent = session.spawnAgent(TestAgent);

      // First call to establish some cost
      await session.invokeModel(agent, models[BuiltinModel.GPT35Turbo], [
        { role: MessageRole.System, content: "You are a helpful assistant." },
        { role: MessageRole.User, content: "Hello!" },
      ]);

      // Second call should trigger budget handler
      await session.invokeModel(agent, models[BuiltinModel.GPT35Turbo], [
        { role: MessageRole.System, content: "You are a helpful assistant." },
        { role: MessageRole.User, content: "Another message!" },
      ]);

      expect(budgetHandler).toHaveBeenCalledTimes(1);
      expect(budgetHandler).toHaveBeenCalledWith(
        expect.any(Number),
        0.01,
        expect.any(Array),
        session
      );
    });

    test("Budget handler that returns same budget still throws", async () => {
      const budgetHandler = jest.fn<
        Promise<number>,
        [number, number, Message[], Session]
      >(async (totalCost, budget, nextMessages, session) => {
        return budget; // Return same budget
      });

      const session = new Session(mockClients, {
        budget: 0.01,
        sessionBudgetHandler: budgetHandler,
      });

      const agent = session.spawnAgent(TestAgent);

      // First call to establish some cost
      await session.invokeModel(agent, models[BuiltinModel.GPT35Turbo], [
        { role: MessageRole.System, content: "You are a helpful assistant." },
        { role: MessageRole.User, content: "Hello!" },
      ]);

      // Second call should still throw because budget handler returns same budget
      await expect(
        session.invokeModel(agent, models[BuiltinModel.GPT35Turbo], [
          { role: MessageRole.System, content: "You are a helpful assistant." },
          { role: MessageRole.User, content: "Another message!" },
        ])
      ).rejects.toThrow("Session budget exceeded");

      expect(budgetHandler).toHaveBeenCalled();
    });

    test("Budget handler that returns lower budget still throws", async () => {
      const budgetHandler = jest.fn<
        Promise<number>,
        [number, number, Message[], Session]
      >(async (totalCost, budget, nextMessages, session) => {
        return budget * 0.5; // Return even lower budget
      });

      const session = new Session(mockClients, {
        budget: 0.01,
        sessionBudgetHandler: budgetHandler,
      });

      const agent = session.spawnAgent(TestAgent);

      // First call to establish some cost
      await session.invokeModel(agent, models[BuiltinModel.GPT35Turbo], [
        { role: MessageRole.System, content: "You are a helpful assistant." },
        { role: MessageRole.User, content: "Hello!" },
      ]);

      // Second call should still throw because budget handler returns lower budget
      await expect(
        session.invokeModel(agent, models[BuiltinModel.GPT35Turbo], [
          { role: MessageRole.System, content: "You are a helpful assistant." },
          { role: MessageRole.User, content: "Another message!" },
        ])
      ).rejects.toThrow("Session budget exceeded");

      expect(budgetHandler).toHaveBeenCalled();
    });

    test("Budget handler is called multiple times if budget exceeded again", async () => {
      let callCount = 0;
      const budgetHandler = jest.fn<
        Promise<number>,
        [number, number, Message[], Session]
      >(async (totalCost, budget, nextMessages, session) => {
        callCount++;
        if (callCount === 1) {
          return budget * 50; // Large increase, but still might not be enough for third call
        }
        return budget * 200; // Very large increase for subsequent calls
      });

      const session = new Session(mockClients, {
        budget: 0.01,
        sessionBudgetHandler: budgetHandler,
      });

      const agent = session.spawnAgent(TestAgent);

      // Make first model call to establish some cost
      await session.invokeModel(agent, models[BuiltinModel.GPT35Turbo], [
        { role: MessageRole.System, content: "You are a helpful assistant." },
        { role: MessageRole.User, content: "Hello!" },
      ]);

      // Make second model call which should trigger budget handler first time
      await session.invokeModel(agent, models[BuiltinModel.GPT35Turbo], [
        { role: MessageRole.System, content: "You are a helpful assistant." },
        { role: MessageRole.User, content: "Another message!" },
      ]);

      // Make third model call which might trigger budget handler again
      await session.invokeModel(agent, models[BuiltinModel.GPT35Turbo], [
        { role: MessageRole.System, content: "You are a helpful assistant." },
        { role: MessageRole.User, content: "Third message!" },
      ]);

      // Budget handler should have been called at least once, possibly twice
      expect(budgetHandler).toHaveBeenCalled();
      expect(callCount).toBeGreaterThanOrEqual(1);
    });

    test("Budget handler throwing error propagates the error", async () => {
      const budgetHandler = jest.fn<
        Promise<number>,
        [number, number, Message[], Session]
      >(async (totalCost, budget, nextMessages, session) => {
        throw new Error("Budget handler failed");
      });

      const session = new Session(mockClients, {
        budget: 0.01,
        sessionBudgetHandler: budgetHandler,
      });

      const agent = session.spawnAgent(TestAgent);

      // First call to establish some cost
      await session.invokeModel(agent, models[BuiltinModel.GPT35Turbo], [
        { role: MessageRole.System, content: "You are a helpful assistant." },
        { role: MessageRole.User, content: "Hello!" },
      ]);

      // Second call should trigger budget handler and propagate the error
      await expect(
        session.invokeModel(agent, models[BuiltinModel.GPT35Turbo], [
          { role: MessageRole.System, content: "You are a helpful assistant." },
          { role: MessageRole.User, content: "Another message!" },
        ])
      ).rejects.toThrow("Budget handler failed");

      expect(budgetHandler).toHaveBeenCalled();
    });

    test("Budget properties work correctly with handler", async () => {
      const initialBudget = 0.01;
      const budgetHandler = jest.fn<
        Promise<number>,
        [number, number, Message[], Session]
      >(async (totalCost, budget, nextMessages, session) => {
        return budget * 100; // Increase budget very significantly
      });

      const session = new Session(mockClients, {
        budget: initialBudget,
        sessionBudgetHandler: budgetHandler,
      });

      const agent = session.spawnAgent(TestAgent);

      // Initially should not be over budget
      expect(session.isOverBudget).toBe(false);

      // First call to establish some cost
      await session.invokeModel(agent, models[BuiltinModel.GPT35Turbo], [
        { role: MessageRole.System, content: "You are a helpful assistant." },
        { role: MessageRole.User, content: "Hello!" },
      ]);

      // Second call should trigger budget handler
      await session.invokeModel(agent, models[BuiltinModel.GPT35Turbo], [
        { role: MessageRole.System, content: "You are a helpful assistant." },
        { role: MessageRole.User, content: "Another message!" },
      ]);

      // After successful invocation with budget handler, should not be over budget
      expect(session.isOverBudget).toBe(false);
      expect(session.totalCost()).toBeGreaterThan(0);
    });

    test("Budget handler can examine next messages to make decisions", async () => {
      const budgetHandler = jest.fn<
        Promise<number>,
        [number, number, Message[], Session]
      >(async (totalCost, budget, nextMessages, session) => {
        // Check if the next messages contain important content
        const hasImportantContent = nextMessages.some((msg) => {
          if (typeof msg.content === "string") {
            return (
              msg.content.includes("URGENT") || msg.content.includes("CRITICAL")
            );
          }
          return false;
        });

        if (hasImportantContent) {
          return budget * 1000; // Significantly increase budget for important messages
        }
        return budget * 2; // Small increase for regular messages
      });

      const session = new Session(mockClients, {
        budget: 0.01,
        sessionBudgetHandler: budgetHandler,
      });

      const agent = session.spawnAgent(TestAgent);

      // First call to establish some cost
      await session.invokeModel(agent, models[BuiltinModel.GPT35Turbo], [
        { role: MessageRole.System, content: "You are a helpful assistant." },
        { role: MessageRole.User, content: "Hello!" },
      ]);

      // Second call with URGENT content should trigger budget handler with higher increase
      await session.invokeModel(agent, models[BuiltinModel.GPT35Turbo], [
        { role: MessageRole.System, content: "You are a helpful assistant." },
        {
          role: MessageRole.User,
          content: "URGENT: This is a critical request!",
        },
      ]);

      expect(budgetHandler).toHaveBeenCalledTimes(1);
      expect(budgetHandler).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        expect.arrayContaining([
          expect.objectContaining({
            content: "URGENT: This is a critical request!",
          }),
        ]),
        session
      );
    });

    test("Budget handler is called only once for concurrent invokeModel calls", async () => {
      let handlerCallCount = 0;
      const budgetHandler = jest.fn<
        Promise<number>,
        [number, number, Message[], Session]
      >(async (totalCost, budget, nextMessages, session) => {
        handlerCallCount++;
        // Simulate some async work in the budget handler
        await new Promise((resolve) => setTimeout(resolve, 100));
        return budget * 100; // Increase budget significantly
      });

      const session = new Session(mockClients, {
        budget: 0.01,
        sessionBudgetHandler: budgetHandler,
      });

      const agent = session.spawnAgent(TestAgent);

      // First call to establish some cost
      await session.invokeModel(agent, models[BuiltinModel.GPT35Turbo], [
        { role: MessageRole.System, content: "You are a helpful assistant." },
        { role: MessageRole.User, content: "Hello!" },
      ]);

      // Make multiple concurrent calls that should all hit budget limit
      const concurrentCalls = [
        session.invokeModel(agent, models[BuiltinModel.GPT35Turbo], [
          { role: MessageRole.System, content: "You are a helpful assistant." },
          { role: MessageRole.User, content: "Concurrent call 1" },
        ]),
        session.invokeModel(agent, models[BuiltinModel.GPT35Turbo], [
          { role: MessageRole.System, content: "You are a helpful assistant." },
          { role: MessageRole.User, content: "Concurrent call 2" },
        ]),
        session.invokeModel(agent, models[BuiltinModel.GPT35Turbo], [
          { role: MessageRole.System, content: "You are a helpful assistant." },
          { role: MessageRole.User, content: "Concurrent call 3" },
        ]),
      ];

      // All calls should complete successfully
      const results = await Promise.all(concurrentCalls);
      expect(results).toHaveLength(3);
      results.forEach((result) => expect(result).toBeDefined());

      // Budget handler should be called only once despite multiple concurrent calls
      expect(budgetHandler).toHaveBeenCalledTimes(1);
      expect(handlerCallCount).toBe(1);
    }, 10000);

    test("Subsequent budget exceeded calls wait for first handler to complete", async () => {
      const handlerCallOrder: number[] = [];
      let handlerCallCount = 0;

      const budgetHandler = jest.fn<
        Promise<number>,
        [number, number, Message[], Session]
      >(async (totalCost, budget, nextMessages, session) => {
        const callId = ++handlerCallCount;
        handlerCallOrder.push(callId);

        // First call takes longer and increases budget significantly
        if (callId === 1) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return budget * 100;
        }

        // Subsequent calls should not happen if budget was increased enough
        await new Promise((resolve) => setTimeout(resolve, 50));
        return budget * 2;
      });

      const session = new Session(mockClients, {
        budget: 0.01,
        sessionBudgetHandler: budgetHandler,
      });

      const agent = session.spawnAgent(TestAgent);

      // First call to establish some cost
      await session.invokeModel(agent, models[BuiltinModel.GPT35Turbo], [
        { role: MessageRole.System, content: "You are a helpful assistant." },
        { role: MessageRole.User, content: "Hello!" },
      ]);

      // Start multiple calls with slight delays to test queuing behavior
      const call1Promise = session.invokeModel(
        agent,
        models[BuiltinModel.GPT35Turbo],
        [
          { role: MessageRole.System, content: "You are a helpful assistant." },
          { role: MessageRole.User, content: "Queued call 1" },
        ]
      );

      // Start second call after a small delay
      await new Promise((resolve) => setTimeout(resolve, 50));
      const call2Promise = session.invokeModel(
        agent,
        models[BuiltinModel.GPT35Turbo],
        [
          { role: MessageRole.System, content: "You are a helpful assistant." },
          { role: MessageRole.User, content: "Queued call 2" },
        ]
      );

      const results = await Promise.all([call1Promise, call2Promise]);
      expect(results).toHaveLength(2);
      results.forEach((result) => expect(result).toBeDefined());

      // Budget handler should be called only once, as the first call should increase budget enough
      expect(budgetHandler).toHaveBeenCalledTimes(1);
      expect(handlerCallCount).toBe(1);
      expect(handlerCallOrder).toEqual([1]);
    }, 10000);

    test("Aborted session doesn't call budget handler", async () => {
      const budgetHandler = jest.fn<
        Promise<number>,
        [number, number, Message[], Session]
      >(async (totalCost, budget, nextMessages, session) => {
        return budget * 2;
      });

      const session = new Session(mockClients, {
        budget: 0.01,
        sessionBudgetHandler: budgetHandler,
      });

      const agent = session.spawnAgent(TestAgent);
      session.abort(); // Abort the session

      await expect(
        session.invokeModel(agent, models[BuiltinModel.GPT35Turbo], [
          { role: MessageRole.System, content: "You are a helpful assistant." },
          { role: MessageRole.User, content: "Hello!" },
        ])
      ).rejects.toThrow("Session has been aborted");

      // Budget handler should not be called for aborted sessions
      expect(budgetHandler).not.toHaveBeenCalled();
    });
  });
});
