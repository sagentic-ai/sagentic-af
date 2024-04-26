// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: MIT

import "openai/shims/node";
import { AgentOptions, BaseAgent } from "../src/agent";
import { ClientMux } from "../src/client_mux";
import { Session } from "../src/session";
import { Provider } from "../src/models";
import {
  Interaction,
  TextAssistantContent,
  TextUserContent,
  Thread,
  ToolCall,
  ToolResult,
  text,
} from "../src/thread";

type ChainMessage = string | ToolCall[] | ToolResult[];

const makeChain = (messages: ChainMessage[]): Interaction => {
  let previous: Interaction | undefined = undefined;
  for (const message of messages) {
    if (previous && !previous.complete) {
      if (typeof message === "string") {
        previous.assistant = { type: "text", text: message as string };
      } else {
        previous.assistant = {
          type: "tool_calls",
          toolCalls: message as ToolCall[],
        };
      }
    } else {
      if (typeof message === "string") {
        previous = new Interaction(
          { type: "text", text: message as string },
          previous
        );
      } else {
        previous = new Interaction(
          {
            type: "tool_results",
            toolResults: message as ToolResult[],
          },
          previous
        );
      }
    }
  }
  return previous!;
};

describe("Interaction", () => {
  test("Create Interaction", () => {
    const interaction = new Interaction(text("Hello"));
    expect(interaction).toBeDefined();
    expect(interaction.user).toEqual(text("Hello"));
    expect(interaction.assistant).toBeUndefined();
    expect(interaction.previous).toBeUndefined();
    expect(interaction.complete).toBeFalsy();
  });

  test("Create Interaction with previous", () => {
    const previous = new Interaction(text("Hello"));

    expect(() => {
      new Interaction(text("World"), previous);
    }).toThrow();

    expect(previous.complete).toBeFalsy();
    previous.assistant = text("World");
    expect(previous.complete).toBeTruthy();

    const interaction = new Interaction(text("What's"), previous);

    expect(interaction).toBeDefined();
    expect((interaction.user as TextUserContent).text).toBe("What's");
    expect(interaction.assistant).toBeUndefined();
    expect(interaction.previous).toBe(previous);
    expect(interaction.complete).toBeFalsy();
  });

  test("Interaction serialization", () => {
    const last = makeChain(["hello", "world", "what's", "up?"]);

    expect(last.complete).toBeTruthy();
    expect(last.user).toEqual(text("what's"));
    expect(last.assistant).toEqual(text("up?"));
    expect(last.previous).toBeDefined();
    expect(last.previous!.complete).toBeTruthy();
    expect((last.previous!.user as TextUserContent).text).toBe("hello");
    expect((last.previous!.assistant as TextAssistantContent).text).toBe(
      "world"
    );
    expect(last.previous!.previous).toBeUndefined();

    expect(last.toMessages()).toStrictEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "world" },
      { role: "user", content: "what's" },
      { role: "assistant", content: "up?" },
    ]);
  });

  test("Incomplete Interaction serialization", () => {
    const last = makeChain(["hello", "world", "what's"]);

    expect(last.complete).toBeFalsy();
    expect(last.user).toEqual(text("what's"));
    expect(last.assistant).toBeUndefined();
    expect(last.previous).toBeDefined();
    expect(last.previous!.complete).toBeTruthy();
    expect((last.previous!.user as TextUserContent).text).toBe("hello");
    expect((last.previous!.assistant as TextAssistantContent).text).toBe(
      "world"
    );
    expect(last.previous!.previous).toBeUndefined();

    expect(last.toMessages()).toStrictEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "world" },
      { role: "user", content: "what's" },
    ]);
  });
});

const makeCall = (id: string, name: string, args: any): ToolCall => {
  const jsonArgs = JSON.stringify(args);
  return {
    id,
    type: "function",
    function: {
      name,
      arguments: jsonArgs,
    },
  };
};

const makeResult = (id: string, result: any): [ToolResult, any] => {
  const jsonResult = JSON.stringify(result);
  return [
    { toolCallID: id, result: jsonResult },
    { role: "tool", content: jsonResult, tool_call_id: id },
  ];
};

describe("Interaction with tools", () => {
  test("Create Interaction with tools", () => {
    const call = makeCall("call-1", "add", { a: 1, b: 2 });
    const [sentResult, expectedResult] = makeResult("call-1", 3);

    const last = makeChain(["hello", [call], [sentResult]]);

    expect(last.toMessages()).toStrictEqual([
      { role: "user", content: "hello" },
      {
        role: "assistant",
        content: null,
        tool_calls: [call],
      },
      expectedResult,
    ]);
  });

  test("Interaction with multiple calls at once", () => {
    const call1 = makeCall("call-1", "add", { a: 1, b: 2 });
    const call2 = makeCall("call-2", "add", { a: 3, b: 4 });
    const [sentResult1, expectedResult1] = makeResult("call-1", 3);
    const [sentResult2, expectedResult2] = makeResult("call-2", 7);

    const last = makeChain([
      "hello",
      [call1, call2],
      [sentResult1, sentResult2],
      "it worked!",
    ]);

    expect(last.toMessages()).toStrictEqual([
      { role: "user", content: "hello" },
      {
        role: "assistant",
        content: null,
        tool_calls: [call1, call2],
      },
      expectedResult1,
      expectedResult2,
      { role: "assistant", content: "it worked!" },
    ]);
  });
});

class TestAgent extends BaseAgent<AgentOptions, undefined, undefined> {}

describe("Thread", () => {
  const clients = new ClientMux({ [Provider.OpenAI]: "fake-key" });
  const session = new Session(clients, { topic: "test" });
  let agent: TestAgent;

  beforeEach(() => {
    agent = new TestAgent(session);
  });

  test("Thread with bogus parent", () => {
    // note: this scenario is prevented by typechecking and should not happen normally
    // we are testing it here for coverage by forcing a type error
    expect(() => {
      const thread = new Thread(undefined as unknown as TestAgent);
      thread.parent;
    }).toThrow();
  });

  test("Basic thread interaction", () => {
    let thread = new Thread(agent, "testing thread");
    expect(thread).toBeDefined();
    expect(thread.parent).toBe(agent);
    expect(thread.metadata).toBeDefined();
    expect(thread.metadata.topic).toBe("testing thread");
    expect(thread.interaction).toBeDefined();
    expect(thread.interaction.assistant).toBeUndefined();
    expect(thread.interaction.previous).toBeUndefined();
    expect(thread.interaction.complete).toBeFalsy();

    expect(thread.parent).toBe(agent);

    // empty thread should not be sendable and have no messages
    expect(thread.isSendable).toBeFalsy();
    expect(thread.messages).toStrictEqual([]);

    // should be empty and not complete
    expect(thread.empty).toBeTruthy();
    expect(thread.complete).toBeFalsy();

    // it is not assistant's turn
    expect(() => {
      thread.appendAssistantMessage("Hello");
    }).toThrow();

    // should be mutable when not complete
    const old = thread;
    thread = thread.appendUserMessage("Hello");
    expect(thread.messages).toStrictEqual([{ role: "user", content: "Hello" }]);
    expect(thread).toBe(old);
    expect(thread.interaction).toBe(old.interaction);

    // should be not empty, not complete and sendable now
    expect(thread.empty).toBeFalsy();
    expect(thread.isSendable).toBeTruthy();
    expect(thread.complete).toBeFalsy();

    // should not accept tool results when we have text prompt
    expect(() => {
      thread.appendToolResult("call-1", "3");
    }).toThrow();

    // should append more text to existing prompt with mutation
    thread = thread.appendUserMessage("World");
    expect(thread.messages).toStrictEqual([
      { role: "user", content: "HelloWorld" },
    ]);
    expect(thread).toBe(old);
    expect(thread.interaction).toBe(old.interaction);

    // should be still not empty, not complete and sendable now
    expect(thread.empty).toBeFalsy();
    expect(thread.isSendable).toBeTruthy();
    expect(thread.complete).toBeFalsy();

    // it's assistants turn now, still with no mutation
    thread = thread.appendAssistantMessage("What's up?");
    expect(thread.messages).toStrictEqual([
      { role: "user", content: "HelloWorld" },
      { role: "assistant", content: "What's up?" },
    ]);
    expect(thread).toBe(old);
    expect(thread.interaction).toBe(old.interaction);

    // should be not empty, complete and not sendable
    expect(thread.empty).toBeFalsy();
    expect(thread.isSendable).toBeFalsy();
    expect(thread.complete).toBeTruthy();

    // it's not assistant's turn anymore
    expect(() => {
      thread.appendAssistantMessage("yoo");
    }).toThrow();

    // should not accept tool results when the assistant replied with text
    expect(() => {
      thread.appendToolResult("call-1", "3");
    }).toThrow();

    // it's user's turn again
    thread = thread.appendUserMessage("Bye");
    expect(thread.messages).toStrictEqual([
      { role: "user", content: "HelloWorld" },
      { role: "assistant", content: "What's up?" },
      { role: "user", content: "Bye" },
    ]);

    // thread should not be mutated anymore
    expect(thread).not.toBe(old);
    expect(thread.interaction).not.toBe(old.interaction);

    // should still belong to the agent
    expect(thread.parent).toBe(agent);

    // should be not empty, not complete and sendable now
    expect(thread.empty).toBeFalsy();
    expect(thread.isSendable).toBeTruthy();
    expect(thread.complete).toBeFalsy();

    // it's assistants turn now, it sends a tool call
    const call = makeCall("call-1", "add", { a: 1, b: 2 });
    thread = thread.appendAssistantToolCalls([call]);
    expect(thread.messages).toStrictEqual([
      { role: "user", content: "HelloWorld" },
      { role: "assistant", content: "What's up?" },
      { role: "user", content: "Bye" },
      {
        role: "assistant",
        content: null,
        tool_calls: [call],
      },
    ]);

    // it should be not empty, complete and not sendable now
    expect(thread.empty).toBeFalsy();
    expect(thread.isSendable).toBeFalsy();
    expect(thread.complete).toBeTruthy();

    // it should expect tool results now
    expect(thread.expectsToolResponse).toBeTruthy();

    // should not accept assistant messages now
    expect(() => {
      thread.appendAssistantMessage("yoo");
    }).toThrow();

    expect(() => {
      thread.appendAssistantToolCalls([call]);
    }).toThrow();

    // should not accept text prompt when we have tool calls
    expect(() => {
      thread.appendUserMessage("yoo");
    }).toThrow();

    // it's tools turn now
    const [sentResult, expectedResult] = makeResult("call-1", 3);
    thread = thread.appendToolResult("call-1", sentResult.result);

    // can't append user messages now
    expect(() => {
      thread.appendUserMessage("yoo");
    }).toThrow();

    expect(thread.messages).toStrictEqual([
      { role: "user", content: "HelloWorld" },
      { role: "assistant", content: "What's up?" },
      { role: "user", content: "Bye" },
      {
        role: "assistant",
        content: null,
        tool_calls: [call],
      },
      expectedResult,
    ]);

    // it should be not empty, not complete and sendable now
    expect(thread.empty).toBeFalsy();
    expect(thread.isSendable).toBeTruthy();
    expect(thread.complete).toBeFalsy();

    // it should not expect tool results now
    expect(thread.expectsToolResponse).toBeFalsy();
  });

  test("Multiple tool usage", () => {
    let thread = new Thread(agent);
    const call1 = makeCall("call-1", "add", { a: 1, b: 2 });
    const call2 = makeCall("call-2", "add", { a: 3, b: 4 });
    const [sentResult1, expectedResult1] = makeResult("call-1", 3);
    const [sentResult2, expectedResult2] = makeResult("call-2", 7);

    thread = thread.appendUserMessage("Hello");

    // empty tool call is verboten
    expect(() => {
      thread.appendAssistantToolCalls([]);
    }).toThrow();

    thread = thread.appendAssistantToolCalls([call1, call2]);

    thread = thread.appendToolResult("call-1", sentResult1.result);

    expect(() => {
      thread.appendUserMessage("Bye");
    }).toThrow();

    thread = thread.appendToolResult("call-2", sentResult2.result);

    expect(() => {
      thread.appendUserMessage("Bye");
    }).toThrow();

    thread = thread.appendAssistantMessage("Bye");

    expect(thread.messages).toStrictEqual([
      { role: "user", content: "Hello" },
      {
        role: "assistant",
        content: null,
        tool_calls: [call1, call2],
      },
      expectedResult1,
      expectedResult2,
      { role: "assistant", content: "Bye" },
    ]);
  });

  test("Undo", () => {
    let thread = new Thread(agent);

    // can't undo when empty
    expect(() => {
      thread.undo();
    }).toThrow();

    thread = thread.appendUserMessage("Hello");

    // can't undo when we only have user message
    expect(() => {
      thread.undo();
    }).toThrow();

    const originalMessages = thread.messages;
    const original = thread;

    // warning, this mutates original as well as we are completing the interaction
    thread = thread.appendAssistantMessage("What's up?");

    const undone = thread.undo();

    expect(undone).not.toBe(original);
    expect(undone).not.toBe(thread);
    expect(undone.interaction).not.toBe(original.interaction);
    expect(undone.interaction).not.toBe(thread.interaction);
    expect(undone.messages).toStrictEqual(originalMessages);
  });

  test("Edit", () => {
    let thread = new Thread(agent);

    // can't edit when empty
    expect(() => {
      thread.edit("Hello");
    }).toThrow();

    thread = thread.appendUserMessage("Hello");

    const edited = thread.edit("Hellorld");
    expect(edited).not.toBe(thread);
    expect(edited.interaction).not.toBe(thread.interaction);
    expect(edited.messages).toStrictEqual([
      { role: "user", content: "Hellorld" },
    ]);
    expect(thread.messages).toStrictEqual([{ role: "user", content: "Hello" }]);

    thread = thread.appendAssistantMessage("What's up?");

    expect(() => {
      thread.edit("Hellold!");
    }).toThrow();
  });

  test("Rollup", () => {
    let thread = new Thread(agent);
    const prev = new Thread(agent);

    let prev2 = new Thread(agent);
    prev2 = prev2.appendUserMessage("Howdy");

    // can't rollup when empty
    expect(() => {
      thread.rollup(prev);
    }).toThrow();

    thread = thread.appendUserMessage("Hello");

    // can't rollup when we only have user message
    expect(() => {
      thread.rollup(prev2);
    }).toThrow();

    thread = thread.appendAssistantMessage("What's up?");

    // can't rollup to empty
    expect(() => {
      thread.rollup(prev);
    }).toThrow();

    // can't rollup to itself
    expect(() => {
      thread.rollup(thread);
    }).toThrow();

    // can't rollup to incomplete
    expect(() => {
      thread.rollup(prev2);
    }).toThrow();

    prev2 = prev2.appendAssistantMessage("How's it going?");

    const rolled = thread.rollup(prev2);

    expect(rolled).not.toBe(thread);
    expect(rolled).not.toBe(prev2);
    expect(rolled.interaction).not.toBe(thread.interaction);
    expect(rolled.interaction).not.toBe(prev2.interaction);

    expect(rolled.messages).toStrictEqual([
      { role: "user", content: "Howdy" },
      { role: "assistant", content: "What's up?" },
    ]);
  });

  test("Serialization with system prompt", () => {
    agent.systemPrompt = "I'm a teapot";
    let thread = new Thread(agent);
    thread = thread.appendUserMessage("Hello");
    thread = thread.appendAssistantMessage("What's up?");
    thread = thread.appendUserMessage("Bye");
    thread = thread.appendAssistantMessage("Bye");

    expect(thread.messages).toStrictEqual([
      { role: "system", content: "I'm a teapot" },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "What's up?" },
      { role: "user", content: "Bye" },
      { role: "assistant", content: "Bye" },
    ]);
  });
});
