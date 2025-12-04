// Copyright 2024 Ahyve AI Inc.
// SPDX-License-Identifier: BUSL-1.1

/**
 * Integration tests for agents using the apply_patch builtin tool.
 *
 * These tests use a mock OpenAI server that simulates apply_patch_call responses
 * and verify that agents can correctly handle file operations.
 */

import "dotenv/config";
import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { z } from "zod";
import { BuiltinModel, BuiltinProvider } from "../src/models";
import { MessageRole, Thread } from "../src/thread";
import { AgentOptions, BaseAgent } from "../src/agent";
import { ClientMux } from "../src/client_mux";
import { Session } from "../src/session";
import {
  BuiltinToolType,
  ApplyPatchCall,
  ApplyPatchResult,
  ApplyPatchOperation,
} from "../src/builtin-tools";
import {
  ApplyPatchHarness,
  createApplyPatchHandler,
  executeApplyPatch,
} from "../src/builtin-tools/apply-patch";
import { ReactiveAgent, when, otherwise } from "../src/agents/reactive";

// ============================================================================
// Virtual File System for Testing
// ============================================================================

/**
 * A virtual file system for testing apply_patch operations
 */
class VirtualFileSystem implements ApplyPatchHarness {
  files: Map<string, string> = new Map();
  operations: { type: string; path: string; content?: string }[] = [];

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }
    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
    this.operations.push({ type: "write", path, content });
  }

  async deleteFile(path: string): Promise<void> {
    if (!this.files.has(path)) {
      throw new Error(`ENOENT: no such file or directory, unlink '${path}'`);
    }
    this.files.delete(path);
    this.operations.push({ type: "delete", path });
  }

  async fileExists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  reset() {
    this.files.clear();
    this.operations = [];
  }

  // Helper to set up initial files
  setFile(path: string, content: string) {
    this.files.set(path, content);
  }
}

// ============================================================================
// Mock Server for Apply Patch
// ============================================================================

/**
 * Simple mock fetch that simulates Responses API with apply_patch support
 */
class ApplyPatchMockFetch {
  private patchResponses: Map<string, ApplyPatchOperation[]> = new Map();
  private followUpResponses: Map<string, string> = new Map();
  private currentCallId = 0;

  /**
   * Configure the server to respond with an apply_patch_call for a given input pattern
   */
  setApplyPatchResponse(
    inputPattern: string,
    operations: ApplyPatchOperation[]
  ) {
    this.patchResponses.set(inputPattern, operations);
  }

  /**
   * Configure a text response after patch operations are handled
   */
  setFollowUpResponse(inputPattern: string, response: string) {
    this.followUpResponses.set(inputPattern, response);
  }

  /**
   * Reset all responses
   */
  reset() {
    this.patchResponses.clear();
    this.followUpResponses.clear();
    this.currentCallId = 0;
  }

  /**
   * Mock fetch function
   */
  fetch = async (
    url: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    const urlStr = url.toString();

    // Handle responses endpoint
    if (urlStr.includes("/responses")) {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      return this.handleResponsesRequest(body);
    }

    // Default 404
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  };

  private async handleResponsesRequest(request: any): Promise<Response> {
    // Check if the request contains apply_patch_call_output (meaning we're in follow-up)
    const hasOutputs = this.hasApplyPatchOutput(request.input);

    // Only look at user messages for pattern matching
    const inputText = this.extractUserInputText(request.input);

    // Check if we should respond with apply_patch_call
    for (const [pattern, operations] of this.patchResponses) {
      if (inputText.includes(pattern)) {
        if (hasOutputs) {
          // Return follow-up text response
          const followUp =
            this.followUpResponses.get(pattern) ||
            "Patch applied successfully!";
          return this.createTextResponse(followUp, request.model);
        } else {
          // Return apply_patch_call
          return this.createApplyPatchResponse(operations, request.model);
        }
      }
    }

    // Default text response
    return this.createTextResponse("I don't understand.", request.model);
  }

  private extractUserInputText(input: any): string {
    if (typeof input === "string") return input;
    if (!Array.isArray(input)) return "";

    let text = "";
    for (const item of input) {
      if (item.type === "message" && item.role === "user") {
        if (typeof item.content === "string") {
          text += item.content;
        } else if (Array.isArray(item.content)) {
          for (const c of item.content) {
            if (c.type === "input_text") text += c.text;
          }
        }
      }
    }
    return text;
  }

  private hasApplyPatchOutput(input: any): boolean {
    if (!Array.isArray(input)) return false;
    return input.some((item: any) => item.type === "apply_patch_call_output");
  }

  private createApplyPatchResponse(
    operations: ApplyPatchOperation[],
    model: string
  ): Response {
    const output = operations.map((op) => {
      const callId = `apc_${++this.currentCallId}`;
      return {
        type: "apply_patch_call",
        id: `ap_${this.currentCallId}`,
        call_id: callId,
        operation: op,
        status: "completed",
      };
    });

    const body = {
      id: `resp_${Date.now()}`,
      created_at: Math.floor(Date.now() / 1000),
      model,
      object: "response",
      output,
      output_text: null,
      parallel_tool_calls: true,
      tool_choice: "auto",
      tools: [],
      top_p: 1,
      truncation: "disabled",
      usage: {
        input_tokens: 100,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: 50,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: 150,
      },
      error: null,
      incomplete_details: null,
      instructions: null,
      metadata: null,
      temperature: 1,
      max_output_tokens: null,
      previous_response_id: null,
      reasoning: null,
      service_tier: "default",
      status: "completed",
      text: { format: { type: "text" } },
    };

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "x-ratelimit-limit-requests": "1000",
        "x-ratelimit-limit-tokens": "100000",
        "x-ratelimit-remaining-requests": "999",
        "x-ratelimit-remaining-tokens": "99900",
        "x-ratelimit-reset-requests": "1s",
        "x-ratelimit-reset-tokens": "1s",
      },
    });
  }

  private createTextResponse(text: string, model: string): Response {
    const body = {
      id: `resp_${Date.now()}`,
      created_at: Math.floor(Date.now() / 1000),
      model,
      object: "response",
      output: [
        {
          type: "message",
          id: `msg_${Date.now()}`,
          status: "completed",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text,
              annotations: [],
            },
          ],
        },
      ],
      output_text: text,
      parallel_tool_calls: true,
      tool_choice: "auto",
      tools: [],
      top_p: 1,
      truncation: "disabled",
      usage: {
        input_tokens: 100,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: 50,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: 150,
      },
      error: null,
      incomplete_details: null,
      instructions: null,
      metadata: null,
      temperature: 1,
      max_output_tokens: null,
      previous_response_id: null,
      reasoning: null,
      service_tier: "default",
      status: "completed",
      text: { format: { type: "text" } },
    };

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "x-ratelimit-limit-requests": "1000",
        "x-ratelimit-limit-tokens": "100000",
        "x-ratelimit-remaining-requests": "999",
        "x-ratelimit-remaining-tokens": "99900",
        "x-ratelimit-reset-requests": "1s",
        "x-ratelimit-reset-tokens": "1s",
      },
    });
  }
}

// ============================================================================
// Basic Agent with Apply Patch
// ============================================================================

interface CodeEditorAgentOptions extends AgentOptions {
  task: string;
  vfs: VirtualFileSystem;
}

interface CodeEditorAgentState {
  task: string;
  iterations: number;
  maxIterations: number;
  completed: boolean;
}

/**
 * A basic agent that uses apply_patch to edit files
 */
class BasicCodeEditorAgent extends BaseAgent<
  CodeEditorAgentOptions,
  CodeEditorAgentState,
  { success: boolean; filesModified: string[] }
> {
  systemPrompt =
    "You are a code editor assistant. Use apply_patch to modify files.";
  builtinTools = [BuiltinToolType.ApplyPatch];

  private vfs: VirtualFileSystem;
  private filesModified: Set<string> = new Set();
  thread!: Thread;

  constructor(session: Session, options: CodeEditorAgentOptions) {
    super(session, options);
    this.vfs = options.vfs;

    // Register the apply_patch handler using the VFS
    this.registerBuiltinToolHandler(
      "apply_patch_call",
      this.handleApplyPatch.bind(this)
    );
  }

  private async handleApplyPatch(
    call: ApplyPatchCall
  ): Promise<ApplyPatchResult> {
    const result = await executeApplyPatch(call, { harness: this.vfs });
    if (result.status === "completed") {
      this.filesModified.add(call.operation.path);
    }
    return result;
  }

  async initialize(
    options: CodeEditorAgentOptions
  ): Promise<CodeEditorAgentState> {
    this.thread = this.createThread();
    this.thread = this.thread.appendUserMessage(options.task);
    return {
      task: options.task,
      iterations: 0,
      maxIterations: 5,
      completed: false,
    };
  }

  async step(state: CodeEditorAgentState): Promise<CodeEditorAgentState> {
    state.iterations++;

    if (state.iterations >= state.maxIterations) {
      this.stop();
      return state;
    }

    this.thread = await this.advance(this.thread);

    // Check if we got a text response (task complete)
    const lastMessage = this.thread.messages[this.thread.messages.length - 1];
    if (
      lastMessage.role === MessageRole.Assistant &&
      !lastMessage.tool_calls &&
      !lastMessage.builtin_tool_calls &&
      lastMessage.content
    ) {
      state.completed = true;
      this.stop();
    }

    return state;
  }

  async finalize(state: CodeEditorAgentState) {
    return {
      success: state.completed,
      filesModified: Array.from(this.filesModified),
    };
  }
}

// ============================================================================
// Reactive Agent with Apply Patch using Decorator
// ============================================================================

interface ReactiveCodeEditorOptions extends AgentOptions {
  vfs: VirtualFileSystem;
}

interface ReactiveCodeEditorState {
  filesCreated: string[];
  filesUpdated: string[];
  filesDeleted: string[];
  done: boolean;
}

const DoneSchema = z.object({
  message: z.string().describe("Completion message"),
});

/**
 * A reactive agent that uses the @handleBuiltinTool decorator
 */
class ReactiveCodeEditorAgent extends ReactiveAgent<
  ReactiveCodeEditorOptions,
  ReactiveCodeEditorState,
  { filesCreated: string[]; filesUpdated: string[]; filesDeleted: string[] }
> {
  systemPrompt = `You are a code editor. Use apply_patch to edit files.
When done, respond with: {"type": "done", "message": "..."}`;

  builtinTools = [BuiltinToolType.ApplyPatch];
  private vfs!: VirtualFileSystem;

  constructor(session: Session, options: ReactiveCodeEditorOptions) {
    super(session, options);
    this.vfs = options.vfs;

    // Register handler manually since decorators run at class definition time
    this.registerBuiltinToolHandler(
      "apply_patch_call",
      this.handlePatch.bind(this)
    );
  }

  async handlePatch(call: ApplyPatchCall): Promise<ApplyPatchResult> {
    return executeApplyPatch(call, { harness: this.vfs });
  }

  async input(
    options: ReactiveCodeEditorOptions
  ): Promise<ReactiveCodeEditorState> {
    return {
      filesCreated: [],
      filesUpdated: [],
      filesDeleted: [],
      done: false,
    };
  }

  async output(state: ReactiveCodeEditorState) {
    return {
      filesCreated: state.filesCreated,
      filesUpdated: state.filesUpdated,
      filesDeleted: state.filesDeleted,
    };
  }

  @when("the task is complete", DoneSchema)
  done(state: ReactiveCodeEditorState, input: z.infer<typeof DoneSchema>) {
    state.done = true;
    this.stop();
    return state;
  }

  @otherwise
  handleOther(state: ReactiveCodeEditorState, message: string) {
    // Track any other messages
    return state;
  }
}

// ============================================================================
// Tests
// ============================================================================

describe("Apply Patch Integration Tests", () => {
  let mockFetch: ApplyPatchMockFetch;
  let clients: ClientMux;
  let session: Session;
  let vfs: VirtualFileSystem;

  beforeAll(async () => {
    mockFetch = new ApplyPatchMockFetch();

    // Create client mux with mock fetch
    clients = new ClientMux(
      { [BuiltinProvider.OpenAI]: "test-key" },
      { openaiApiType: "responses" },
      {
        [BuiltinModel.GPT4oMini]: {
          fetch: mockFetch.fetch,
        },
      }
    );
    clients.start();
  });

  afterAll(() => {
    clients.stop();
  });

  beforeEach(() => {
    vfs = new VirtualFileSystem();
    session = new Session(clients, { budget: 10 });
    mockFetch.reset();
  });

  afterEach(() => {
    session.abort();
    vfs.reset();
  });

  describe("BasicCodeEditorAgent", () => {
    test("creates a new file", async () => {
      // Configure mock to respond with create_file operation
      mockFetch.setApplyPatchResponse("Create hello.txt", [
        {
          type: "create_file",
          path: "hello.txt",
          diff: "+Hello, World!",
        },
      ]);
      mockFetch.setFollowUpResponse(
        "Create hello.txt",
        "Created hello.txt successfully!"
      );

      const agent = session.spawnAgent(BasicCodeEditorAgent, {
        model: BuiltinModel.GPT4oMini,
        task: "Create hello.txt with content 'Hello, World!'",
        vfs,
      } as CodeEditorAgentOptions);

      const result = await agent.run();

      expect(result.success).toBe(true);
      expect(result.filesModified).toContain("hello.txt");
      expect(vfs.files.get("hello.txt")).toBe("Hello, World!");
    });

    test("updates an existing file", async () => {
      // Set up initial file
      vfs.setFile("config.json", '{"debug": false}');

      // Configure mock to respond with update_file operation
      mockFetch.setApplyPatchResponse("Enable debug", [
        {
          type: "update_file",
          path: "config.json",
          diff: `@@ -1 +1 @@
-{"debug": false}
+{"debug": true}`,
        },
      ]);
      mockFetch.setFollowUpResponse("Enable debug", "Debug mode enabled!");

      const agent = session.spawnAgent(BasicCodeEditorAgent, {
        model: BuiltinModel.GPT4oMini,
        task: "Enable debug mode in config.json",
        vfs,
      } as CodeEditorAgentOptions);

      const result = await agent.run();

      expect(result.success).toBe(true);
      expect(result.filesModified).toContain("config.json");
      expect(vfs.files.get("config.json")).toBe('{"debug": true}');
    });

    test("deletes a file", async () => {
      // Set up file to delete
      vfs.setFile("temp.txt", "temporary content");

      // Configure mock to respond with delete_file operation
      mockFetch.setApplyPatchResponse("Delete temp", [
        {
          type: "delete_file",
          path: "temp.txt",
        },
      ]);
      mockFetch.setFollowUpResponse("Delete temp", "Deleted temp.txt!");

      const agent = session.spawnAgent(BasicCodeEditorAgent, {
        model: BuiltinModel.GPT4oMini,
        task: "Delete temp.txt",
        vfs,
      } as CodeEditorAgentOptions);

      const result = await agent.run();

      expect(result.success).toBe(true);
      expect(result.filesModified).toContain("temp.txt");
      expect(vfs.files.has("temp.txt")).toBe(false);
    });

    test("handles multiple file operations", async () => {
      vfs.setFile("old.txt", "old content");

      // Configure mock to respond with multiple operations
      mockFetch.setApplyPatchResponse("Refactor files", [
        {
          type: "create_file",
          path: "new.txt",
          diff: "+new content",
        },
        {
          type: "delete_file",
          path: "old.txt",
        },
      ]);
      mockFetch.setFollowUpResponse("Refactor files", "Refactoring complete!");

      const agent = session.spawnAgent(BasicCodeEditorAgent, {
        model: BuiltinModel.GPT4oMini,
        task: "Refactor files: create new.txt and delete old.txt",
        vfs,
      } as CodeEditorAgentOptions);

      const result = await agent.run();

      expect(result.success).toBe(true);
      expect(result.filesModified).toContain("new.txt");
      expect(result.filesModified).toContain("old.txt");
      expect(vfs.files.get("new.txt")).toBe("new content");
      expect(vfs.files.has("old.txt")).toBe(false);
    });

    test("handles error when file doesn't exist for update", async () => {
      // Configure mock to try updating non-existent file
      mockFetch.setApplyPatchResponse("Update missing", [
        {
          type: "update_file",
          path: "missing.txt",
          diff: "@@ -1 +1 @@\n-old\n+new",
        },
      ]);
      mockFetch.setFollowUpResponse(
        "Update missing",
        "Error occurred but handled."
      );

      const agent = session.spawnAgent(BasicCodeEditorAgent, {
        model: BuiltinModel.GPT4oMini,
        task: "Update missing.txt file",
        vfs,
      } as CodeEditorAgentOptions);

      const result = await agent.run();

      // The agent should still complete, but the file won't be in modified list
      expect(result.success).toBe(true);
      expect(result.filesModified).not.toContain("missing.txt");
    });
  });

  describe("Complex diff operations", () => {
    test("applies multi-line diff correctly", async () => {
      vfs.setFile(
        "app.ts",
        `function hello() {
  console.log("hello");
}

function world() {
  console.log("world");
}`
      );

      mockFetch.setApplyPatchResponse("Add greeting", [
        {
          type: "update_file",
          path: "app.ts",
          diff: `@@ -1,7 +1,11 @@
+function greeting() {
+  console.log("greeting");
+}
+
 function hello() {
   console.log("hello");
 }
 
 function world() {
   console.log("world");
 }`,
        },
      ]);
      mockFetch.setFollowUpResponse("Add greeting", "Added greeting function!");

      const agent = session.spawnAgent(BasicCodeEditorAgent, {
        model: BuiltinModel.GPT4oMini,
        task: "Add greeting function at the top of app.ts",
        vfs,
      } as CodeEditorAgentOptions);

      const result = await agent.run();

      expect(result.success).toBe(true);
      const content = vfs.files.get("app.ts");
      expect(content).toContain("function greeting()");
      expect(content).toContain("function hello()");
      expect(content).toContain("function world()");
    });
  });

  describe("VirtualFileSystem", () => {
    test("tracks all operations", async () => {
      mockFetch.setApplyPatchResponse("Track ops", [
        {
          type: "create_file",
          path: "a.txt",
          diff: "+content a",
        },
        {
          type: "create_file",
          path: "b.txt",
          diff: "+content b",
        },
      ]);
      mockFetch.setFollowUpResponse("Track ops", "Done tracking!");

      const agent = session.spawnAgent(BasicCodeEditorAgent, {
        model: BuiltinModel.GPT4oMini,
        task: "Track ops: create a.txt and b.txt",
        vfs,
      } as CodeEditorAgentOptions);

      await agent.run();

      expect(vfs.operations).toHaveLength(2);
      expect(vfs.operations[0]).toEqual({
        type: "write",
        path: "a.txt",
        content: "content a",
      });
      expect(vfs.operations[1]).toEqual({
        type: "write",
        path: "b.txt",
        content: "content b",
      });
    });
  });
});

describe("Apply Patch Harness Integration", () => {
  test("createApplyPatchHandler creates working handler", async () => {
    const vfs = new VirtualFileSystem();
    vfs.setFile("test.txt", "original");

    const handler = createApplyPatchHandler(vfs);

    const call: ApplyPatchCall = {
      id: "ap_1",
      call_id: "call_1",
      type: "apply_patch_call",
      operation: {
        type: "update_file",
        path: "test.txt",
        diff: "@@ -1 +1 @@\n-original\n+modified",
      },
      status: "in_progress",
    };

    const result = await handler(call);

    expect(result.status).toBe("completed");
    expect(vfs.files.get("test.txt")).toBe("modified");
  });

  test("handler respects dryRun option", async () => {
    const vfs = new VirtualFileSystem();

    const handler = createApplyPatchHandler(vfs, { dryRun: true });

    const call: ApplyPatchCall = {
      id: "ap_1",
      call_id: "call_1",
      type: "apply_patch_call",
      operation: {
        type: "create_file",
        path: "test.txt",
        diff: "+content",
      },
      status: "in_progress",
    };

    const result = await handler(call);

    expect(result.status).toBe("completed");
    expect(result.output).toContain("[DRY RUN]");
    expect(vfs.files.has("test.txt")).toBe(false);
  });

  test("handler calls onProgress callback", async () => {
    const vfs = new VirtualFileSystem();
    const progressMessages: string[] = [];

    const handler = createApplyPatchHandler(vfs, {
      onProgress: (msg) => progressMessages.push(msg),
    });

    const call: ApplyPatchCall = {
      id: "ap_1",
      call_id: "call_1",
      type: "apply_patch_call",
      operation: {
        type: "create_file",
        path: "progress.txt",
        diff: "+content",
      },
      status: "in_progress",
    };

    await handler(call);

    expect(progressMessages).toHaveLength(1);
    expect(progressMessages[0]).toContain("Creating file");
    expect(progressMessages[0]).toContain("progress.txt");
  });
});

// ============================================================================
// Real API Integration Tests
// ============================================================================

const openaiApiKey = process.env.OPENAI_API_KEY || "";

// Skip real API tests if no API key
const describeWithKey = openaiApiKey ? describe : describe.skip;

/**
 * A real code editing agent that uses apply_patch with the actual OpenAI API
 */
class RealCodeEditorAgent extends BaseAgent<
  CodeEditorAgentOptions,
  CodeEditorAgentState,
  { success: boolean; filesModified: string[]; response: string }
> {
  systemPrompt = `You are a code editing assistant. When asked to edit files, use the apply_patch tool.
After making changes, briefly confirm what you did.`;

  builtinTools = [BuiltinToolType.ApplyPatch];

  private vfs: VirtualFileSystem;
  private filesModified: Set<string> = new Set();
  thread!: Thread;

  constructor(session: Session, options: CodeEditorAgentOptions) {
    super(session, options);
    this.vfs = options.vfs;

    this.registerBuiltinToolHandler(
      "apply_patch_call",
      this.handleApplyPatch.bind(this)
    );
  }

  private async handleApplyPatch(
    call: ApplyPatchCall
  ): Promise<ApplyPatchResult> {
    console.log(
      `[RealAPI] Handling apply_patch: ${call.operation.type} on ${call.operation.path}`
    );
    const result = await executeApplyPatch(call, { harness: this.vfs });
    if (result.status === "completed") {
      this.filesModified.add(call.operation.path);
    }
    console.log(`[RealAPI] Result: ${result.status} - ${result.output}`);
    return result;
  }

  async initialize(
    options: CodeEditorAgentOptions
  ): Promise<CodeEditorAgentState> {
    this.thread = this.createThread();
    this.thread = this.thread.appendUserMessage(options.task);
    return {
      task: options.task,
      iterations: 0,
      maxIterations: 5,
      completed: false,
    };
  }

  async step(state: CodeEditorAgentState): Promise<CodeEditorAgentState> {
    state.iterations++;

    if (state.iterations >= state.maxIterations) {
      console.log("[RealAPI] Max iterations reached");
      this.stop();
      return state;
    }

    console.log(`[RealAPI] Step ${state.iterations}`);
    this.thread = await this.advance(this.thread);

    // Check if we got a text response (task complete)
    const lastMessage = this.thread.messages[this.thread.messages.length - 1];
    if (
      lastMessage.role === MessageRole.Assistant &&
      !lastMessage.tool_calls &&
      !lastMessage.builtin_tool_calls &&
      lastMessage.content
    ) {
      console.log("[RealAPI] Got final text response");
      state.completed = true;
      this.stop();
    }

    return state;
  }

  async finalize(state: CodeEditorAgentState) {
    return {
      success: state.completed,
      filesModified: Array.from(this.filesModified),
      response: this.thread.assistantResponse,
    };
  }
}

// Model that supports apply_patch - only gpt-5.1 with responses API
const APPLY_PATCH_MODEL = BuiltinModel.GPT51;

describeWithKey("Real API Apply Patch Integration", () => {
  let clients: ClientMux;
  let session: Session;
  let vfs: VirtualFileSystem;

  beforeAll(() => {
    clients = new ClientMux(
      { [BuiltinProvider.OpenAI]: openaiApiKey },
      { openaiApiType: "responses" }
    );
    clients.start();
  });

  afterAll(() => {
    clients.stop();
  });

  beforeEach(() => {
    vfs = new VirtualFileSystem();
    session = new Session(clients, { budget: 1 }); // $1 budget for real API calls
  });

  afterEach(() => {
    session.abort();
    vfs.reset();
  });

  test("creates a new file using real API", async () => {
    const agent = session.spawnAgent(RealCodeEditorAgent, {
      model: APPLY_PATCH_MODEL,
      task: 'Create a file named "greeting.txt" with the content "Hello from apply_patch!"',
      vfs,
    } as CodeEditorAgentOptions);

    const result = await agent.run();

    console.log("[RealAPI] Result:", result);
    console.log("[RealAPI] Files:", Array.from(vfs.files.entries()));

    expect(result.success).toBe(true);
    expect(result.filesModified).toContain("greeting.txt");
    expect(vfs.files.has("greeting.txt")).toBe(true);

    const content = vfs.files.get("greeting.txt");
    expect(content).toContain("Hello");
  }, 60000);

  test("updates an existing file using real API", async () => {
    // Set up initial file
    vfs.setFile(
      "config.json",
      JSON.stringify({ debug: false, version: "1.0" }, null, 2)
    );

    const agent = session.spawnAgent(RealCodeEditorAgent, {
      model: APPLY_PATCH_MODEL,
      task: 'Update config.json to set debug to true. The current content is: {"debug": false, "version": "1.0"}',
      vfs,
    } as CodeEditorAgentOptions);

    const result = await agent.run();

    console.log("[RealAPI] Result:", result);
    console.log("[RealAPI] Files:", Array.from(vfs.files.entries()));

    expect(result.success).toBe(true);
    expect(result.filesModified).toContain("config.json");

    const content = vfs.files.get("config.json");
    expect(content).toBeDefined();
    // The content should have debug: true
    expect(content).toMatch(/debug.*true/);
  }, 60000);

  test("deletes a file using real API", async () => {
    // Set up file to delete
    vfs.setFile("to-delete.txt", "This file should be deleted");

    const agent = session.spawnAgent(RealCodeEditorAgent, {
      model: APPLY_PATCH_MODEL,
      task: "Delete the file named to-delete.txt",
      vfs,
    } as CodeEditorAgentOptions);

    const result = await agent.run();

    console.log("[RealAPI] Result:", result);
    console.log("[RealAPI] Files:", Array.from(vfs.files.entries()));

    expect(result.success).toBe(true);
    expect(result.filesModified).toContain("to-delete.txt");
    expect(vfs.files.has("to-delete.txt")).toBe(false);
  }, 60000);

  test("creates a TypeScript file with code using real API", async () => {
    const agent = session.spawnAgent(RealCodeEditorAgent, {
      model: APPLY_PATCH_MODEL,
      task: `Create a file named "utils.ts" with a simple TypeScript function that adds two numbers. The function should be named "add" and take parameters a and b of type number.`,
      vfs,
    } as CodeEditorAgentOptions);

    const result = await agent.run();

    console.log("[RealAPI] Result:", result);
    console.log("[RealAPI] Files:", Array.from(vfs.files.entries()));

    expect(result.success).toBe(true);
    expect(result.filesModified).toContain("utils.ts");
    expect(vfs.files.has("utils.ts")).toBe(true);

    const content = vfs.files.get("utils.ts");
    expect(content).toContain("function");
    expect(content).toContain("add");
    expect(content).toMatch(/number/);
  }, 60000);
});
