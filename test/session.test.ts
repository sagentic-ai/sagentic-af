import "openai/shims/node";
import { Session } from "../src/session";
import { AgentOptions, BaseAgent } from "../src/agent";
import { ClientMux } from "../src/client";

class TestAgent extends BaseAgent<AgentOptions, undefined, undefined> {}

describe("Session", () => {
  const clients = new ClientMux("fake-key");

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
});
